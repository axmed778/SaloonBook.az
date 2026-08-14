import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// Proves that Postgres — not application code — refuses cross-tenant rows for
// queries routed through withTenantScope. Opt-in: it needs a real database AND
// a role that genuinely lacks BYPASSRLS, so it is skipped unless both URLs are
// exported. `pnpm test` therefore keeps passing on a machine with no database.
//
//   pnpm db:up
//   createdb rlstest   # or: psql -c 'CREATE DATABASE rlstest'
//   export TEST_DB=postgresql://postgres:postgres@localhost:5432/rlstest
//   DATABASE_URL=$TEST_DB pnpm db:setup        # migrate + constraints + grants
//   DATABASE_URL=$TEST_DB pnpm db:rls
//   psql $TEST_DB -c "CREATE ROLE salonbook_app LOGIN PASSWORD 'x' NOBYPASSRLS NOSUPERUSER"
//   DATABASE_URL=$TEST_DB pnpm db:rls-grants   # grants for that role
//   RLS_TEST_DATABASE_URL=$TEST_DB \
//   RLS_TEST_APP_DATABASE_URL=postgresql://salonbook_app:x@localhost:5432/rlstest \
//     pnpm test:rls
//
// NOTE: app_rls_strict() keys strict mode on `current_user = 'salonbook_app'`,
// so the test role must carry exactly that name for the strict assertions to
// exercise anything.

const OWNER_URL = process.env.RLS_TEST_DATABASE_URL;
const APP_URL = process.env.RLS_TEST_APP_DATABASE_URL;

/** The salonId-keyed tables rls.sql covers. Salon itself is keyed by its own id. */
const SALON_ID_MODELS = [
  "employee",
  "service",
  "customer",
  "appointment",
  "notification",
  "payout",
  "customerNote",
  "usageCounter",
  "review",
] as const;

type Tenant = {
  accountId: string;
  salonId: string;
  employeeId: string;
  serviceId: string;
  customerId: string;
  appointmentId: string;
  clientId: string;
};

async function seedTenant(db: PrismaClient, tag: string, dayOffset: number): Promise<Tenant> {
  const account = await db.account.create({ data: { name: `rls-${tag}` } });
  const salon = await db.salon.create({
    data: { accountId: account.id, slug: `rls-${tag}-${randomUUID().slice(0, 8)}`, name: `Salon ${tag}` },
  });
  const employee = await db.employee.create({ data: { salonId: salon.id, name: `Master ${tag}` } });
  const service = await db.service.create({
    data: { salonId: salon.id, name: `Service ${tag}`, priceMinor: 1000, durationMin: 30 },
  });
  const customer = await db.customer.create({
    data: { salonId: salon.id, name: `Client ${tag}`, phone: `+9945000000${dayOffset}` },
  });

  // Distinct windows per tenant so the overlap EXCLUDE constraint can never fire.
  const startsAt = new Date(Date.UTC(2030, 0, 1 + dayOffset, 9, 0, 0));
  const endsAt = new Date(Date.UTC(2030, 0, 1 + dayOffset, 9, 30, 0));
  const appointment = await db.appointment.create({
    data: {
      salonId: salon.id,
      employeeId: employee.id,
      serviceId: service.id,
      customerId: customer.id,
      startsAt,
      endsAt,
      priceMinor: 1000,
      status: "COMPLETED",
    },
  });

  await db.customerNote.create({
    data: { salonId: salon.id, customerId: customer.id, body: `secret note ${tag}` },
  });
  await db.payout.create({
    data: { salonId: salon.id, employeeId: employee.id, periodYm: "2030-01", amountMinor: 50000 },
  });
  await db.notification.create({
    data: { salonId: salon.id, template: `t_${tag}`, toPhone: `+9945000000${dayOffset}`, payload: {} },
  });
  await db.usageCounter.create({
    data: { salonId: salon.id, periodYm: "2030-01", bookings: 1 },
  });

  const client = await db.client.create({ data: { phone: `+9945111111${dayOffset}` } });
  await db.review.create({
    data: { clientId: client.id, salonId: salon.id, appointmentId: appointment.id, rating: 5 },
  });

  return {
    accountId: account.id,
    salonId: salon.id,
    employeeId: employee.id,
    serviceId: service.id,
    customerId: customer.id,
    appointmentId: appointment.id,
    clientId: client.id,
  };
}

async function destroyTenant(db: PrismaClient, t: Tenant): Promise<void> {
  await db.review.deleteMany({ where: { salonId: t.salonId } });
  await db.client.deleteMany({ where: { id: t.clientId } });
  await db.usageCounter.deleteMany({ where: { salonId: t.salonId } });
  await db.notification.deleteMany({ where: { salonId: t.salonId } });
  await db.payout.deleteMany({ where: { salonId: t.salonId } });
  await db.customerNote.deleteMany({ where: { salonId: t.salonId } });
  await db.appointment.deleteMany({ where: { salonId: t.salonId } });
  await db.customer.deleteMany({ where: { salonId: t.salonId } });
  await db.service.deleteMany({ where: { salonId: t.salonId } });
  await db.employee.deleteMany({ where: { salonId: t.salonId } });
  await db.salon.deleteMany({ where: { id: t.salonId } });
  await db.account.deleteMany({ where: { id: t.accountId } });
}

describe.skipIf(!OWNER_URL || !APP_URL)("RLS tenant isolation", () => {
  let owner: PrismaClient;
  let app: PrismaClient;
  let withTenantScope: typeof import("./tenant").withTenantScope;
  let A: Tenant;
  let B: Tenant;

  beforeAll(async () => {
    owner = new PrismaClient({ datasourceUrl: OWNER_URL });
    app = new PrismaClient({ datasourceUrl: APP_URL });
    A = await seedTenant(owner, "a", 1);
    B = await seedTenant(owner, "b", 2);

    // Import the REAL helper only after pointing it at the restricted role, so
    // the test exercises production code rather than a reimplementation.
    process.env.RLS_DATABASE_URL = APP_URL;
    ({ withTenantScope } = await import("./tenant"));
  }, 60_000);

  afterAll(async () => {
    if (owner) {
      if (A) await destroyTenant(owner, A);
      if (B) await destroyTenant(owner, B);
      await owner.$disconnect();
    }
    if (app) await app.$disconnect();
  });

  // Positive control FIRST. Without it, a broken fixture makes every isolation
  // assertion below pass vacuously on an empty database.
  it("owner connection sees both tenants (fixture is real)", async () => {
    for (const model of SALON_ID_MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (owner as any)[model].findMany({
        where: { salonId: { in: [A.salonId, B.salonId] } },
      });
      expect(rows.length, `${model} should have rows for both tenants`).toBe(2);
    }
    const salons = await owner.salon.findMany({ where: { id: { in: [A.salonId, B.salonId] } } });
    expect(salons.length).toBe(2);
  });

  // THE MONEY ASSERTION: no `where` at all. If this passes, Postgres — not a
  // WHERE clause we remembered to write — is doing the scoping.
  it("an unfiltered findMany inside a scope returns only that tenant's rows", async () => {
    await withTenantScope(A.salonId, async (tx) => {
      for (const model of SALON_ID_MODELS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: { salonId: string }[] = await (tx as any)[model].findMany({});
        const foreign = rows.filter((r) => r.salonId !== A.salonId);
        expect(foreign, `${model} leaked rows from another salon`).toEqual([]);
        expect(rows.length, `${model} should still see its own row`).toBeGreaterThan(0);
      }
      const salons = await tx.salon.findMany({});
      expect(salons.map((s) => s.id)).toEqual([A.salonId]);
    });
  });

  it("hides another tenant's row even when its id is known", async () => {
    await withTenantScope(A.salonId, async (tx) => {
      expect(await tx.customer.findUnique({ where: { id: B.customerId } })).toBeNull();
      expect(await tx.customerNote.findFirst({ where: { salonId: B.salonId } })).toBeNull();
    });
  });

  it("rejects a cross-tenant write", async () => {
    await withTenantScope(A.salonId, async (tx) => {
      // No visible row to update -> Prisma reports "record not found".
      await expect(
        tx.customer.update({ where: { id: B.customerId }, data: { name: "hijacked" } }),
      ).rejects.toThrow();

      // WITH CHECK refuses an insert stamped with another tenant's salonId.
      await expect(
        tx.customerNote.create({
          data: { salonId: B.salonId, customerId: B.customerId, body: "injected" },
        }),
      ).rejects.toThrow();
    });

    const b = await owner.customer.findUnique({ where: { id: B.customerId } });
    expect(b?.name).toBe("Client b");
  });

  it("does not let a scoped deleteMany touch another tenant", async () => {
    await withTenantScope(A.salonId, async (tx) => {
      await tx.customerNote.deleteMany({ where: {} });
    });
    // A's note is gone, B's survives.
    expect(await owner.customerNote.count({ where: { salonId: A.salonId } })).toBe(0);
    expect(await owner.customerNote.count({ where: { salonId: B.salonId } })).toBe(1);
    // Restore so later tests still see a full fixture.
    await owner.customerNote.create({
      data: { salonId: A.salonId, customerId: A.customerId, body: "secret note a" },
    });
  });

  it("gives raw SQL no exemption", async () => {
    await withTenantScope(A.salonId, async (tx) => {
      const [{ count }] = await tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count FROM "Customer"
      `;
      expect(Number(count)).toBe(1);
    });
  });

  // The GUC-leak regression. set_config(..., true) is transaction-scoped, but on
  // commit Postgres leaves the placeholder defined with an EMPTY-STRING value
  // rather than NULL — which is why app_current_salon() wraps it in NULLIF. If
  // this breaks, one tenant's context bleeds into the next request served by the
  // same pooled connection.
  it("leaves no salon context behind after a scope commits", async () => {
    await withTenantScope(A.salonId, async (tx) => {
      await tx.customer.findMany({});
    });
    const [row] = await app.$queryRaw<{ helper_null: boolean }[]>`
      SELECT app_current_salon() IS NULL AS helper_null
    `;
    expect(row.helper_null).toBe(true);

    // And the next scope sees only B.
    await withTenantScope(B.salonId, async (tx) => {
      const rows = await tx.customer.findMany({});
      expect(rows.map((r) => r.salonId)).toEqual([B.salonId]);
    });
  });

  // The safety property the whole rollout rests on: applying rls.sql is a no-op
  // for a role that is not marked strict, so production's existing connection is
  // unaffected.
  it("stays permissive for a non-strict role and strict for the app role", async () => {
    const [{ strict }] = await app.$queryRaw<{ strict: boolean }[]>`
      SELECT app_rls_strict() AS strict
    `;
    if (strict) {
      // Unscoped read on the strict role: denied.
      expect(await app.customer.count({ where: { salonId: { in: [A.salonId, B.salonId] } } })).toBe(
        0,
      );
    }
    // The owner (strict unset) still sees everything — this is the no-op proof.
    expect(
      await owner.customer.count({ where: { salonId: { in: [A.salonId, B.salonId] } } }),
    ).toBe(2);
  });

  // Schema drift: a tenant table added six months from now fails here instead of
  // quietly leaking. Keep EXEMPT in sync with the comment block in rls.sql.
  it("covers every salonId-carrying table (or exempts it deliberately)", async () => {
    const EXEMPT = new Set(["WhatsAppSender", "PushSubscription", "Membership"]);
    const rows = await owner.$queryRaw<{ table_name: string }[]>`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND a.attname = 'salonId'
        AND NOT a.attisdropped
    `;
    const unprotected: string[] = [];
    for (const { table_name } of rows) {
      if (EXEMPT.has(table_name)) continue;
      const [flags] = await owner.$queryRaw<{ forced: boolean; policies: bigint }[]>`
        SELECT c.relforcerowsecurity AS forced,
               (SELECT count(*) FROM pg_policies p
                 WHERE p.schemaname = 'public'
                   AND p.tablename = c.relname
                   AND p.policyname = 'tenant_isolation') AS policies
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ${table_name}
      `;
      if (!flags?.forced || Number(flags.policies) !== 1) unprotected.push(table_name);
    }
    expect(unprotected, "tenant tables missing a tenant_isolation policy").toEqual([]);
  });
});

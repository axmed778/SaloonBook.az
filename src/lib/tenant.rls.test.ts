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

/**
 * Tables with no salonId of their own: rls.sql scopes them through their parent
 * employee, so the isolation assertions key on employeeId instead.
 * ServiceEmployee is handled separately — it is a junction with two parents and
 * no scalar id.
 */
const EMPLOYEE_REF_MODELS = ["workingHour", "timeOff"] as const;

type Tenant = {
  accountId: string;
  salonId: string;
  employeeId: string;
  serviceId: string;
  customerId: string;
  appointmentId: string;
  clientId: string;
  workingHourId: string;
  timeOffId: string;
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

  // The three indirectly scoped tables: availability, absences and the
  // service<->staff junction all hang off the employee, never off a salonId.
  const workingHour = await db.workingHour.create({
    data: { employeeId: employee.id, weekday: dayOffset, startMin: 9 * 60, endMin: 18 * 60 },
  });
  const timeOff = await db.timeOff.create({
    data: {
      employeeId: employee.id,
      startsAt: new Date(Date.UTC(2030, 1, 1 + dayOffset, 0, 0, 0)),
      endsAt: new Date(Date.UTC(2030, 1, 2 + dayOffset, 0, 0, 0)),
      reason: `vacation ${tag}`,
    },
  });
  await db.serviceEmployee.create({ data: { serviceId: service.id, employeeId: employee.id } });

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
    workingHourId: workingHour.id,
    timeOffId: timeOff.id,
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
  await db.serviceEmployee.deleteMany({ where: { employeeId: t.employeeId } });
  await db.workingHour.deleteMany({ where: { employeeId: t.employeeId } });
  await db.timeOff.deleteMany({ where: { employeeId: t.employeeId } });
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
    for (const model of EMPLOYEE_REF_MODELS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = await (owner as any)[model].findMany({
        where: { employeeId: { in: [A.employeeId, B.employeeId] } },
      });
      expect(rows.length, `${model} should have rows for both tenants`).toBe(2);
    }
    const links = await owner.serviceEmployee.findMany({
      where: { employeeId: { in: [A.employeeId, B.employeeId] } },
    });
    expect(links.length).toBe(2);
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
      // Same property one hop out: the parent-EXISTS policies must scope these
      // as tightly as a local salonId would.
      for (const model of EMPLOYEE_REF_MODELS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rows: { employeeId: string }[] = await (tx as any)[model].findMany({});
        const foreign = rows.filter((r) => r.employeeId !== A.employeeId);
        expect(foreign, `${model} leaked rows from another salon`).toEqual([]);
        expect(rows.length, `${model} should still see its own row`).toBeGreaterThan(0);
      }
      const links = await tx.serviceEmployee.findMany({});
      expect(links).toEqual([{ serviceId: A.serviceId, employeeId: A.employeeId }]);

      const salons = await tx.salon.findMany({});
      expect(salons.map((s) => s.id)).toEqual([A.salonId]);
    });
  });

  it("hides another tenant's row even when its id is known", async () => {
    await withTenantScope(A.salonId, async (tx) => {
      expect(await tx.customer.findUnique({ where: { id: B.customerId } })).toBeNull();
      expect(await tx.customerNote.findFirst({ where: { salonId: B.salonId } })).toBeNull();
      expect(await tx.workingHour.findUnique({ where: { id: B.workingHourId } })).toBeNull();
      expect(await tx.timeOff.findUnique({ where: { id: B.timeOffId } })).toBeNull();
      expect(
        await tx.serviceEmployee.findUnique({
          where: { serviceId_employeeId: { serviceId: B.serviceId, employeeId: B.employeeId } },
        }),
      ).toBeNull();
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

  // One scope per attempt on purpose: the first failed statement aborts the
  // surrounding transaction, so a second attempt inside it would reject with
  // "transaction is aborted" and prove nothing about the policy.
  it("rejects a cross-tenant write to an indirectly scoped table", async () => {
    // WITH CHECK resolves B's employee to B's salon and refuses the insert.
    await expect(
      withTenantScope(A.salonId, (tx) =>
        tx.workingHour.create({
          data: { employeeId: B.employeeId, weekday: 3, startMin: 0, endMin: 60 },
        }),
      ),
    ).rejects.toThrow();

    await expect(
      withTenantScope(A.salonId, (tx) =>
        tx.timeOff.update({ where: { id: B.timeOffId }, data: { reason: "hijacked" } }),
      ),
    ).rejects.toThrow();

    // The junction needs BOTH parents in the tenant, so stapling A's own
    // service onto B's employee must fail too.
    await expect(
      withTenantScope(A.salonId, (tx) =>
        tx.serviceEmployee.create({ data: { serviceId: A.serviceId, employeeId: B.employeeId } }),
      ),
    ).rejects.toThrow();

    // A scoped wipe cannot reach across either.
    await withTenantScope(A.salonId, async (tx) => {
      await tx.workingHour.deleteMany({ where: {} });
    });
    expect(await owner.workingHour.count({ where: { employeeId: A.employeeId } })).toBe(0);
    expect(await owner.workingHour.count({ where: { employeeId: B.employeeId } })).toBe(1);
    expect(await owner.timeOff.findUnique({ where: { id: B.timeOffId } })).toMatchObject({
      reason: "vacation b",
    });
    expect(await owner.serviceEmployee.count({ where: { employeeId: B.employeeId } })).toBe(1);

    // Restore so later tests still see a full fixture.
    const restored = await owner.workingHour.create({
      data: { employeeId: A.employeeId, weekday: 1, startMin: 9 * 60, endMin: 18 * 60 },
    });
    A.workingHourId = restored.id;
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
  //
  // The tenant set is DERIVED from the catalog, never hand-listed: a table
  // belongs to it if it carries any of the tenant-bearing foreign keys (a table
  // reachable from a salon has at least one of them), plus Salon itself, which
  // is keyed by its own id. That is what caught WorkingHour/TimeOff/
  // ServiceEmployee — they have no salonId, so a salonId-only probe declared
  // them protected by never looking at them.
  it("covers every tenant table (or exempts it deliberately)", async () => {
    const EXEMPT = new Set(["WhatsAppSender", "PushSubscription", "Membership"]);
    const rows = await owner.$queryRaw<
      { table_name: string; enabled: boolean; forced: boolean; policies: bigint }[]
    >`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced,
             (SELECT count(*) FROM pg_policies p
               WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND (c.relname = 'Salon' OR EXISTS (
              SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid
                AND NOT a.attisdropped
                AND a.attname IN ('salonId', 'employeeId', 'serviceId', 'customerId')
            ))
    `;
    const found = rows.map((r) => r.table_name);
    // Guards against the query itself going silent: a typo that returns nothing
    // would otherwise make this test pass with an empty tenant set.
    expect(found).toEqual(
      expect.arrayContaining([
        "Salon",
        "Appointment",
        "WorkingHour",
        "TimeOff",
        "ServiceEmployee",
      ]),
    );

    const unprotected = rows
      .filter((r) => !EXEMPT.has(r.table_name))
      .filter((r) => !r.enabled || !r.forced || Number(r.policies) < 1)
      .map((r) => r.table_name);
    expect(unprotected, "tenant tables missing an RLS policy").toEqual([]);
  });
});

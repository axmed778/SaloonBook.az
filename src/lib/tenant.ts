import type { Prisma } from "@prisma/client";
import { prismaRls } from "./prisma";

/**
 * Sets the per-transaction salon context that RLS policies (prisma/security/rls.sql)
 * read via current_setting('app.current_salon'). Pass the transaction client.
 * The `true` third arg scopes the setting to the current transaction only.
 *
 * NEVER change that `true`, and never call this on the base client instead of
 * `tx`. A session-scoped GUC on a pooled connection survives into the NEXT
 * request served by that connection and would scope one tenant's queries to
 * another tenant — the exact cross-tenant read this mechanism exists to
 * prevent. The GUC-leak assertion in tenant.rls.test.ts is the regression test.
 */
export async function setSalonContext(
  tx: Prisma.TransactionClient,
  salonId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.current_salon', ${salonId}, true)`;
}

/**
 * Runs `fn` inside a transaction whose `app.current_salon` is bound to `salonId`,
 * so the RLS policies in prisma/security/rls.sql engage and scope every query to
 * this tenant. This is the safety net that turns a missing `where: { salonId }`
 * from a cross-tenant data leak into "zero rows".
 *
 * Runs on `prismaRls`, which is the restricted `salonbook_app` role when
 * RLS_DATABASE_URL is set and the ordinary client otherwise. So with that
 * variable unset — local dev, CI, and production before activation — this is a
 * harmless wrapper around a normal transaction, exactly as before.
 *
 * NOTE: any lookup needed to RESOLVE the salonId (e.g. salon-by-slug on the public
 * page) must happen BEFORE entering this scope — once inside, RLS hides salons
 * other than `salonId`.
 */
export function withTenantScope<T>(
  salonId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prismaRls.$transaction(
    async (tx) => {
      await setSalonContext(tx, salonId);
      return fn(tx);
    },
    // A booking runs ~10 sequential queries. Prisma's default 5s interactive-
    // transaction timeout is too tight when the DB is a round-trip away (e.g.
    // app and DB in different regions). Give ample headroom so it can't abort
    // mid-write. The real fix for latency is colocating app + DB.
    { timeout: 20_000, maxWait: 8_000 },
  );
}

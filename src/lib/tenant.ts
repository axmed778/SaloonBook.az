import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Sets the per-transaction salon context that RLS policies (prisma/security/rls.sql)
 * read via current_setting('app.current_salon'). Pass the transaction client.
 * The `true` third arg scopes the setting to the current transaction only.
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
 * RLS only bites when the app connects as a NON-owner role (see rls.sql / README);
 * with the default owner role, or when RLS is not applied (local dev), this is a
 * harmless no-op wrapper around a normal transaction.
 *
 * NOTE: any lookup needed to RESOLVE the salonId (e.g. salon-by-slug on the public
 * page) must happen BEFORE entering this scope — once inside, RLS hides salons
 * other than `salonId`.
 */
export function withTenantScope<T>(
  salonId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
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

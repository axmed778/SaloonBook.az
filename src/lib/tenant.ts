import type { Prisma } from "@prisma/client";

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

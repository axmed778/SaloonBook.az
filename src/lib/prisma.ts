import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaRls?: PrismaClient;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

const rlsUrl = process.env.RLS_DATABASE_URL;

// Second client, bound to the `salonbook_app` role: NOBYPASSRLS, with
// app.rls_strict='on' set at the role level (prisma/security/rls-grants.sql), so
// the policies in prisma/security/rls.sql actually deny rows on it.
//
// ONLY withTenantScope (src/lib/tenant.ts) uses this client. Every other query
// in the app — the dashboard, all of src/app/api/**, the worker, the admin
// panel, migrations — keeps the owner connection on DATABASE_URL and is
// byte-for-byte unaffected.
//
// Unset => this IS `prisma`, i.e. exactly today's behaviour. That covers local
// dev, CI, and the production rollback path: delete the variable, restart.
//
// Pin connection_limit on the URL itself (?connection_limit=5): this is a
// SECOND pool against the same database and Prisma defaults to cpus*2+1 per
// client.
export const prismaRls: PrismaClient = rlsUrl
  ? (globalForPrisma.prismaRls ??
    new PrismaClient({
      datasourceUrl: rlsUrl,
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    }))
  : prisma;

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  if (rlsUrl) globalForPrisma.prismaRls = prismaRls;
}

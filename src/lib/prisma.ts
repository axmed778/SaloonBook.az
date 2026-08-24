import { PrismaClient } from "@prisma/client";

// ---------------------------------------------------------------------------
// ONE PrismaClient per Node process — web, worker, and one-off scripts alike.
//
// A PrismaClient is a CONNECTION POOL, not a handle: each instance opens up to
// num_cpus * 2 + 1 connections to Postgres. Every extra instance is another
// pool, and on a scale-to-zero Postgres (Neon) those extra pools are what shows
// up in the dashboard as "connections spike to near-max while row writes stay
// flat", and they keep the compute from ever reaching its 5-minute autosuspend.
//
// The globalThis cache is deliberately NOT dev-only any more:
//   * `next dev` hot-reload re-evaluates this module on every edit — the classic
//     reason for the guard.
//   * `tsx watch worker/index.ts` does the same for the worker process.
//   * Even in production a module can be evaluated more than once when it ends
//     up in several bundles (instrumentation vs. route handlers vs. server
//     actions). Without the cache each evaluation opened a brand-new pool.
// Caching unconditionally is harmless — worst case the lookup returns the same
// object — and it makes "exactly one client" true per PROCESS instead of per
// module evaluation.
//
// NOTE (limit of this, and of any singleton): separate OS processes cannot share
// a client. The Railway web service and the Railway worker service each get
// their own pool, as does every `npx tsx scripts/...` run. That is why the
// runtime connection string must be Neon's POOLED endpoint (`-pooler` in the
// hostname): PgBouncer fans all of those pools into a small number of real
// backend connections, so the compute can go idle and autosuspend.
// ---------------------------------------------------------------------------

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaRls?: PrismaClient;
};

function clientOptions(datasourceUrl?: string) {
  return {
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: (process.env.NODE_ENV === "development"
      ? ["warn", "error"]
      : ["error"]) as ("warn" | "error")[],
  };
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient(clientOptions());

globalForPrisma.prisma = prisma;

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
// client. Point it at the POOLED (`-pooler`) host too, for the same reason
// DATABASE_URL does.
export const prismaRls: PrismaClient = rlsUrl
  ? (globalForPrisma.prismaRls ?? new PrismaClient(clientOptions(rlsUrl)))
  : prisma;

if (rlsUrl) globalForPrisma.prismaRls = prismaRls;

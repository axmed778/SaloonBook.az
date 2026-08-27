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

// ---------------------------------------------------------------------------
// Pool SIZE. Left alone, Prisma sizes the pool as num_cpus * 2 + 1 — a number
// picked by whichever container the process lands on, so a shared-CPU Railway
// instance gets a pool of 3. The dashboard analytics page fires ~15 queries in
// one Promise.all; the tail of them then sit in Prisma's queue and, if the
// queue outlives pool_timeout, fail with P2024 ("Timed out fetching a new
// connection") rather than being slow.
//
// The numbers:
//   connection_limit=10  Lets the analytics fan-out finish in two waves instead
//     of five, with headroom for a couple of concurrent requests on top.
//     Raising it is cheap HERE specifically: with runtime traffic on Neon's
//     "-pooler" host these are client connections to PgBouncer, which
//     multiplexes them onto a handful of real backend connections — so a bigger
//     Prisma pool does not add compute connections or CU-hours, which is the
//     whole reason the pooled endpoint is mandatory (see the note below). Ten
//     is still small enough that one runaway process cannot monopolise the
//     pooler, and small enough to stay under a plain unpooled Postgres's
//     max_connections when a deployment has no pooler at all.
//   pool_timeout=20      Seconds a query waits for a free connection. Matched to
//     withTenantScope's 20s interactive-transaction budget (src/lib/tenant.ts):
//     a request queuing for a connection and a request holding one then fail on
//     a comparable clock, instead of the queue giving up while work is still
//     legitimately in flight on a cross-region round trip.
//
// A parameter already present on the URL always wins. `?connection_limit=…&
// pool_timeout=…` on the connection string is this repo's documented knob
// (.env.example, README) and an operator who tuned it must not be silently
// overridden from code. These are defaults for every URL that does NOT carry
// them: local dev, CI, Railway Postgres, and any production URL wired up before
// the parameters were documented.
const POOL_DEFAULTS: Record<string, string> = {
  connection_limit: "10",
  pool_timeout: "20",
};

// The RLS client is a SECOND pool against the same database, used only by
// withTenantScope, so it gets a smaller share of the same budget.
const RLS_POOL_DEFAULTS: Record<string, string> = {
  connection_limit: "5",
  pool_timeout: "20",
};

function withPoolDefaults(
  raw: string | undefined,
  defaults: Record<string, string>,
): string | undefined {
  if (!raw || raw.trim() === "") return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Not a parseable URL. Hand it back untouched — Prisma reports the actual
    // problem far better than a guess made here would.
    return raw;
  }
  for (const [key, value] of Object.entries(defaults)) {
    if (!url.searchParams.has(key)) url.searchParams.set(key, value);
  }
  return url.toString();
}

function clientOptions(datasourceUrl?: string) {
  return {
    ...(datasourceUrl ? { datasourceUrl } : {}),
    log: (process.env.NODE_ENV === "development"
      ? ["warn", "error"]
      : ["error"]) as ("warn" | "error")[],
  };
}

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient(clientOptions(withPoolDefaults(process.env.DATABASE_URL, POOL_DEFAULTS)));

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
// client. RLS_POOL_DEFAULTS supplies that cap when the URL omits it. Point it
// at the POOLED (`-pooler`) host too, for the same reason DATABASE_URL does.
export const prismaRls: PrismaClient = rlsUrl
  ? (globalForPrisma.prismaRls ??
    new PrismaClient(clientOptions(withPoolDefaults(rlsUrl, RLS_POOL_DEFAULTS))))
  : prisma;

if (rlsUrl) globalForPrisma.prismaRls = prismaRls;

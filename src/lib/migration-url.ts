// Which connection string migrations and the SQL scripts may use — refused
// before anything connects, rather than discovered as a lock left behind.
//
// `prisma migrate deploy` takes a SESSION-level advisory lock (72707369) and
// releases it at the end. Through Neon's PgBouncer in transaction mode the
// lock and the unlock can land on different server connections, and the
// session that holds it goes back to the pool idle, lock and all. The next
// deploy's pre-deploy then waits on that lock and fails. The fix is a direct
// connection; this makes the wrong one impossible to use by accident.
//
// PURE: reads the two strings it is given, nothing else.

export interface DbUrls {
  DATABASE_URL?: string;
  DIRECT_URL?: string;
}

function parse(raw: string | undefined): URL | null {
  if (!raw || raw.trim() === "") return null;
  try {
    return new URL(raw.trim());
  } catch {
    return null;
  }
}

const isNeon = (u: URL) => u.hostname.endsWith(".neon.tech");
const isPooled = (u: URL) => u.hostname.includes("-pooler") || u.searchParams.get("pgbouncer") === "true";

/**
 * The URL migrations will run on — DIRECT_URL, or DATABASE_URL where there is
 * no direct one (a local Postgres) — or why it must not be used. Only Neon has
 * the pooled/direct split; any other Postgres passes as it is.
 */
export function migrationUrl(env: DbUrls): { url: string } | { error: string } {
  const direct = parse(env.DIRECT_URL);
  const runtime = parse(env.DATABASE_URL);

  if (direct) {
    if (isNeon(direct) && isPooled(direct)) {
      return {
        error:
          `DIRECT_URL points at Neon's POOLED endpoint (${direct.hostname}). Migrations ` +
          "take an advisory lock that a transaction-mode pooler leaves held after " +
          "they finish. Set DIRECT_URL to the direct endpoint: the same host without " +
          "'-pooler', and without 'pgbouncer=true'.",
      };
    }
    return { url: env.DIRECT_URL!.trim() };
  }

  if (runtime && isNeon(runtime)) {
    return {
      error:
        "DIRECT_URL is not set, and DATABASE_URL is a Neon URL. Migrations and the SQL " +
        "scripts need Neon's direct endpoint (no '-pooler') in DIRECT_URL.",
    };
  }
  if (!runtime) return { error: "Neither DIRECT_URL nor DATABASE_URL is set." };
  return { url: env.DATABASE_URL!.trim() };
}

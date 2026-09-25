// ---------------------------------------------------------------------------
// Retry a database call that failed only because the server was not there yet.
//
// Neon's compute autosuspends after five idle minutes, and the query that wakes
// it does not wait for the wake-up: it fails outright with "Can't reach database
// server at …". So a cold database is the NORMAL first query for anything that
// runs on a schedule rather than on a request — the scheduled job is by
// definition the thing that arrives after an idle stretch — and a job that
// treats that first failure as final simply does not run that day.
//
// Only connectivity is retried. A constraint violation or a bad query fails
// identically on every attempt, and retrying a write that may already have
// committed is worse than failing, so anything else is rethrown untouched.
// ---------------------------------------------------------------------------

/** Attempts in total, not retries after the first. Three covers a cold start. */
export const DB_RETRY_ATTEMPTS = 3;

/**
 * Pause between attempts. Neon's cold start is a few hundred milliseconds to a
 * couple of seconds; four gives it room without making a genuinely-down database
 * cost more than ~8s of a scheduled job's time.
 */
export const DB_RETRY_DELAY_MS = 4_000;

// Prisma's connectivity errors. P1001 "Can't reach database server" is the one a
// suspended Neon compute produces; the others are the same class (the server was
// not reachable, or dropped the connection) and are equally safe to repeat.
const RETRYABLE_CODES = new Set(["P1001", "P1002", "P1008", "P1017"]);

const RETRYABLE_MESSAGES =
  /can't reach database server|server has closed the connection|connection closed|connection refused|econnrefused|etimedout|kind: closed/i;

/**
 * True when the error says "the database was not reachable", not "your query was
 * wrong". Matches on Prisma's error code where there is one and falls back to the
 * message, because a failure during client initialisation carries no code.
 */
export function isDbUnreachable(e: unknown): boolean {
  const code = (e as { code?: unknown } | null | undefined)?.code;
  if (typeof code === "string" && RETRYABLE_CODES.has(code)) return true;

  const name = (e as { name?: unknown } | null | undefined)?.name;
  if (name === "PrismaClientInitializationError") return true;

  return RETRYABLE_MESSAGES.test(e instanceof Error ? e.message : String(e ?? ""));
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a database call, repeating it while it fails for lack of a reachable
 * server.
 *
 * `label` prefixes the retry warning, so a log shows which job waited on the
 * wake-up. `sleep` is injectable for tests only.
 */
export async function withDbRetry<T>(
  label: string,
  run: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? DB_RETRY_ATTEMPTS);
  const delayMs = opts.delayMs ?? DB_RETRY_DELAY_MS;
  const sleep = opts.sleep ?? realSleep;

  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (attempt >= attempts || !isDbUnreachable(e)) throw e;
      const detail = e instanceof Error ? e.message.split("\n")[0] : String(e);
      console.warn(
        `[${label}] database unreachable (attempt ${attempt}/${attempts}), retrying in ${delayMs}ms — ${detail}`,
      );
      await sleep(delayMs);
    }
  }
}

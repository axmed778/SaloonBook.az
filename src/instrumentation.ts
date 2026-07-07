// Next.js runs this once when the server process starts (both web and, when
// imported, other runtimes). We use it to fail fast on insecure production
// configuration. Keep it Node-runtime only — the checks read process.env.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" || !process.env.NEXT_RUNTIME) {
    const { assertEnv } = await import("./lib/env");
    assertEnv();
  }
}

/**
 * Server-side error tracking. Next calls this for EVERY uncaught error in
 * server components, route handlers, and server actions — including ones the
 * user only sees as a digest code. Logged as one structured JSON line so
 * Railway's log search can filter on `"src":"onRequestError"` and correlate
 * the digest a user reports with the real stack. Swap the console.error for a
 * Sentry/webhook call later without touching call sites.
 */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(
    JSON.stringify({
      src: "onRequestError",
      ts: new Date().toISOString(),
      message: err.message,
      digest: (err as { digest?: string }).digest ?? null,
      stack: err.stack?.split("\n").slice(0, 8).join(" | ") ?? null,
      method: request.method,
      path: request.path,
      route: context.routePath,
      routeType: context.routeType,
    }),
  );
}

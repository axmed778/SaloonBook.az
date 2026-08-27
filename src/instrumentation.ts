// Statically imported: src/lib/observability.ts pulls in nothing Node-specific
// (fetch, TextEncoder, globalThis.crypto only), so it is safe in the edge
// runtime that also evaluates this file. `assertEnv` below stays a dynamic
// import because it is Node-only.
import { captureError } from "./lib/observability";

// Next.js runs this once when the server process starts (both web and, when
// imported, other runtimes). We use it to fail fast on insecure production
// configuration. Keep it Node-runtime only — the checks read process.env.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" || !process.env.NEXT_RUNTIME) {
    const { assertEnv } = await import("./lib/env");
    assertEnv("web");
  }
}

/**
 * Server-side error tracking. Next calls this for EVERY uncaught error in
 * server components, route handlers, and server actions — including ones the
 * user only sees as a digest code. Logged as one structured JSON line so
 * Railway's log search can filter on `"src":"onRequestError"` and correlate
 * the digest a user reports with the real stack — the log stays the source of
 * truth. captureError is the push half: it forwards the same error to Sentry
 * and/or the alert webhook so it reaches somebody who is not tailing logs.
 */
export function onRequestError(
  error: unknown,
  request: { path: string; method: string },
  context: { routerKind: string; routePath: string; routeType: string },
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  const digest = (err as { digest?: string }).digest ?? null;
  console.error(
    JSON.stringify({
      src: "onRequestError",
      ts: new Date().toISOString(),
      message: err.message,
      digest,
      stack: err.stack?.split("\n").slice(0, 8).join(" | ") ?? null,
      method: request.method,
      path: request.path,
      route: context.routePath,
      routeType: context.routeType,
    }),
  );

  // Fire and forget: Next does not await this hook, and blocking the response
  // on a third-party ingest would turn a monitoring outage into a site outage.
  // captureError never rejects, so the `void` cannot become an unhandled one.
  void captureError(err, {
    source: "onRequestError",
    tags: {
      // The digest is what a user reads off the error page, so it is the key
      // that ties a support message to the event in Sentry.
      digest,
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
    },
    extra: { path: request.path },
  });
}

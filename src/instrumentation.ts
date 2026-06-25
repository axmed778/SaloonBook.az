// Next.js runs this once when the server process starts (both web and, when
// imported, other runtimes). We use it to fail fast on insecure production
// configuration. Keep it Node-runtime only — the checks read process.env.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs" || !process.env.NEXT_RUNTIME) {
    const { assertEnv } = await import("./lib/env");
    assertEnv();
  }
}

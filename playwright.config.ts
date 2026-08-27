import { defineConfig, devices } from "@playwright/test";

// The smoke suite runs against a REAL server backed by a REAL database — the
// public booking page is a Prisma read and the login route hashes a password,
// so neither can be exercised against a stub. `pnpm db:seed` must have run
// against $DATABASE_URL first; e2e/fixtures.ts documents what it expects.
const PORT = Number(process.env.E2E_PORT ?? 3000);

// 127.0.0.1, not localhost: on Windows and on some CI images `localhost`
// resolves to ::1 first while `next start` binds IPv4 only, which shows up as
// a connection-refused webServer timeout rather than a test failure.
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Keep every Playwright artifact under e2e/ so the repo root stays clean and
  // one .gitignore (e2e/.gitignore) covers all of it.
  outputDir: "./e2e/.artifacts/test-results",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // One worker in CI: the login spec spends the account's per-IP rate-limit
  // budget (10 attempts / 60s in src/app/api/auth/login/route.ts), so parallel
  // shards hitting the same server would start failing with 429 instead of 401.
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "./e2e/.artifacts/report", open: "never" }]]
    : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // The app is AZ-first (localePrefix "as-needed", localeDetection false), so
    // the un-prefixed URLs the specs use serve Azerbaijani.
    locale: "az-AZ",
    timezoneId: "Asia/Baku",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // A production build, not `next dev`: dev mode relaxes the CSP (see
  // next.config.ts) and compiles routes lazily, so a dev-only pass would prove
  // nothing about what actually ships. Set E2E_BASE_URL to point the suite at
  // an already-running server and skip this entirely.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "pnpm build && pnpm start",
        url: `${baseURL}/api/health`,
        reuseExistingServer: !process.env.CI,
        // `next build` on a cold cache is the slow part, not the boot.
        timeout: 10 * 60 * 1000,
        env: { PORT: String(PORT) },
        stdout: "pipe",
        stderr: "pipe",
      },
});

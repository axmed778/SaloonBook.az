// `pnpm build` (CI, the e2e webServer and Railway's buildCommand all run it):
// `next build`, then a check that the service worker actually came out of it.
//
// @serwist/next compiles src/app/sw.ts to public/sw.js through a webpack hook.
// Next 16 builds with Turbopack by default, where that hook never runs: Serwist
// prints a warning, the build still "succeeds", and the app ships without a
// service worker — Web Push and the installable app stop working, and nothing
// in CI notices. So from Next 16 on the build passes `--webpack`. It can't just
// live in package.json: Next 15 rejects `--webpack` as an unknown option.
//
// Drop the flag once the service worker moves to Serwist's Turbopack support;
// keep the check either way.
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("next/package.json") as { version: string };
const major = Number(version.split(".")[0]);

const SW = "public/sw.js";
// A service worker left over from an earlier build would satisfy the check
// below without this build having produced one. It is a gitignored artifact.
rmSync(SW, { force: true });

const args = ["build", ...(major >= 16 ? ["--webpack"] : []), ...process.argv.slice(2)];
console.log(`[build] next ${version}: next ${args.join(" ")}`);
const r = spawnSync(process.execPath, [require.resolve("next/dist/bin/next"), ...args], {
  stdio: "inherit",
});
if (r.status !== 0) process.exit(r.status ?? 1);

if (!existsSync(SW)) {
  console.error(
    `[build] ${SW} was not generated — the build ran without Serwist's webpack hook ` +
      "(Turbopack?), so the app would ship with no service worker: no Web Push, " +
      "no install. See scripts/next-build.ts.",
  );
  process.exit(1);
}

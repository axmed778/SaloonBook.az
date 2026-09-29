// First step of `pnpm db:setup` (Railway's preDeployCommand): stop the deploy
// with a clear message before `prisma migrate deploy` connects through Neon's
// pooler and leaves its advisory lock held. See src/lib/migration-url.ts.
import { migrationUrl } from "../src/lib/migration-url";

const r = migrationUrl({ DATABASE_URL: process.env.DATABASE_URL, DIRECT_URL: process.env.DIRECT_URL });
if ("error" in r) {
  console.error(`[db:setup] ${r.error}`);
  process.exit(1);
}
console.log(`[db:setup] migrations will connect to ${new URL(r.url).hostname}`);

/**
 * Read-only check that the tenant RLS policies actually exist ON THE DATABASE
 * YOU POINT IT AT.
 *
 *   pnpm db:rls:verify
 *
 * WHY THIS EXISTS. `prisma/security/rls.sql` is applied BY HAND (`pnpm db:rls`),
 * deliberately, so it is the one part of the schema a deploy cannot carry. Every
 * check we had verified the intent rather than the fact: the CI job reads the
 * SQL file, and src/lib/tenant.rls.test.ts runs against a local database it sets
 * up itself. Neither can see production.
 *
 * They were all green while seven of the seventeen tenant tables had no policy
 * in production — AppointmentAddon and ServiceAddon since the add-ons release,
 * the three indirectly-scoped tables since they were added, and
 * AppointmentPayment since finance phase 2. The drift lasted weeks and nothing
 * could have reported it. This closes that: point it at a database and it
 * answers for that database.
 *
 * The table list is parsed OUT OF rls.sql rather than repeated here. A list
 * copied into this file would be a third place to forget, and it would go stale
 * in exactly the situation the check exists for.
 *
 * Read-only: it runs SELECTs against the catalog and nothing else, so it is safe
 * against production at any time.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Same connection choice as scripts/apply-sql.ts: the direct (unpooled) endpoint
// when there is one, so this reads the same database `pnpm db:rls` writes to.
const datasourceUrl = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL;
if (!datasourceUrl) {
  console.error("verify-rls: set DIRECT_URL or DATABASE_URL to the database to check.");
  process.exit(2);
}
const prisma = new PrismaClient({ datasourceUrl, log: ["error"] });

const RLS_SQL = resolve("prisma/security/rls.sql");

/** The tenant tables named in rls.sql, in the order the file lists them. */
function tenantTables(): string[] {
  // Line comments first: the exemption notes above the array name tables
  // (WhatsAppSender, PushSubscription, …) that are deliberately NOT covered.
  const sql = readFileSync(RLS_SQL, "utf8").replace(/--.*$/gm, "");
  const m = /tenant_tables\s+text\[\]\s*:=\s*ARRAY\[([\s\S]*?)\]/.exec(sql);
  if (!m) {
    throw new Error(`verify-rls: no tenant_tables array found in ${RLS_SQL} — was it renamed?`);
  }
  const tables = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (tables.length === 0) throw new Error("verify-rls: tenant_tables array is empty.");
  return tables;
}

interface Row {
  tbl: string;
  table_exists: boolean;
  rowsecurity: boolean;
  forced: boolean;
  tenant_isolation: bigint;
}

/** Where we are looking, without the password. */
function describeTarget(): string {
  try {
    const u = new URL(datasourceUrl!);
    return `${u.hostname}${u.port ? `:${u.port}` : ""}/${u.pathname.replace(/^\//, "") || "?"}`;
  } catch {
    return "(unparseable connection string)";
  }
}

async function main(): Promise<void> {
  const tables = tenantTables();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT e.tbl,
            (c.oid IS NOT NULL) AS table_exists,
            COALESCE(c.relrowsecurity, false) AS rowsecurity,
            COALESCE(c.relforcerowsecurity, false) AS forced,
            COUNT(p.polname) FILTER (WHERE p.polname = 'tenant_isolation') AS tenant_isolation
       FROM unnest($1::text[]) AS e(tbl)
       LEFT JOIN pg_class c
              ON c.relname = e.tbl AND c.relnamespace = 'public'::regnamespace
       LEFT JOIN pg_policy p ON p.polrelid = c.oid
      GROUP BY e.tbl, c.oid, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY e.tbl`,
    tables,
  );

  const [{ who }] = await prisma.$queryRawUnsafe<{ who: string }[]>(
    "SELECT current_user AS who",
  );
  console.log(`verify-rls: ${describeTarget()} as ${who}`);
  console.log(`verify-rls: ${tables.length} tenant table(s) listed in prisma/security/rls.sql\n`);

  const failures: string[] = [];
  const unforced: string[] = [];
  const width = Math.max(...tables.map((t) => t.length), 5);

  for (const r of rows) {
    const policy = Number(r.tenant_isolation) > 0;
    const ok = r.table_exists && r.rowsecurity && policy;
    if (!r.table_exists) failures.push(`${r.tbl}: table does not exist`);
    else if (!r.rowsecurity) failures.push(`${r.tbl}: row security is OFF`);
    else if (!policy) failures.push(`${r.tbl}: no tenant_isolation policy`);
    // Without FORCE the table owner bypasses the policy entirely, which is how
    // the app's main connection runs. Not a failure on its own — the policy is
    // still there for the restricted role — but it is never what we intend.
    if (r.table_exists && r.rowsecurity && !r.forced) unforced.push(r.tbl);

    const mark = ok ? "ok  " : "FAIL";
    console.log(
      `  ${mark} ${r.tbl.padEnd(width)}  rowsecurity=${String(r.rowsecurity).padEnd(5)}` +
        ` forced=${String(r.forced).padEnd(5)} tenant_isolation=${policy ? 1 : 0}`,
    );
  }

  if (unforced.length > 0) {
    console.log(`\nverify-rls: WARNING — row security not FORCED on: ${unforced.join(", ")}`);
    console.log("  The owner connection bypasses the policy on these tables.");
  }

  if (failures.length > 0) {
    console.error(`\nverify-rls: FAILED — ${failures.length} of ${rows.length} table(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\nApply the policies with:  pnpm db:rls");
    process.exitCode = 1;
    return;
  }

  console.log(`\nverify-rls: OK — all ${rows.length} tenant tables carry tenant_isolation.`);
}

main()
  .catch((e) => {
    console.error("verify-rls: could not complete the check");
    console.error(e);
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());

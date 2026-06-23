import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";

// Splits a SQL file into statements, respecting PostgreSQL dollar-quoted blocks
// ($$ ... $$, $tag$ ... $tag$) so semicolons inside DO blocks don't split.
function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  let dollarTag: string | null = null;

  while (i < sql.length) {
    const ch = sql[i];

    if (ch === "$") {
      const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (m) {
        const tag = m[0];
        if (dollarTag === null) {
          dollarTag = tag;
        } else if (dollarTag === tag) {
          dollarTag = null;
        }
        current += tag;
        i += tag.length;
        continue;
      }
    }

    if (ch === ";" && dollarTag === null) {
      if (current.trim()) statements.push(current.trim());
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/apply-sql.ts <file.sql>");
    process.exit(1);
  }

  const raw = readFileSync(resolve(file), "utf8");
  const withoutLineComments = raw.replace(/--.*$/gm, "");
  const statements = splitSql(withoutLineComments);

  console.log(`Applying ${statements.length} statement(s) from ${file} ...`);
  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

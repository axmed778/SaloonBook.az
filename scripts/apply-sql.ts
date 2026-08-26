import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// This script applies DDL, so it needs the DIRECT (unpooled) connection — the
// one thing that must NOT go through the shared client in src/lib/prisma.ts.
//
// That client is bound to DATABASE_URL, which points at Neon's POOLED endpoint.
// PgBouncer's transaction mode runs every statement inside an implicit
// transaction, and `CREATE INDEX CONCURRENTLY` cannot exist in one: Postgres
// rejects it with 25001. It passed local testing because a direct Postgres runs
// these in autocommit; it only surfaced against Neon, at deploy time, inside
// preDeployCommand — which failed the whole deploy.
//
// This is the same split Prisma itself draws with `directUrl` for migrations,
// and for the same reasons: DDL, advisory locks and CONCURRENTLY all need a
// real backend connection held for the duration.
//
// Deliberately its own PrismaClient despite the one-client-per-process rule in
// src/lib/prisma.ts: this is a short-lived one-off process, and it needs
// different connection semantics from the app. Falls back to DATABASE_URL so
// local development (a direct Postgres, no DIRECT_URL) keeps working.
const datasourceUrl = process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL;
const prisma = new PrismaClient({ datasourceUrl, log: ["error"] });

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

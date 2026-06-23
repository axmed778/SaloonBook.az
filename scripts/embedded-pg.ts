// Local-only: runs a portable PostgreSQL (no Docker/admin) for development and
// demos. Keeps running until killed (SIGINT/SIGTERM). Data persists in ./.devdb.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";

const DATA_DIR = "./.devdb";

const pg = new EmbeddedPostgres({
  databaseDir: DATA_DIR,
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
  // UTF-8 is mandatory — the product is Azerbaijani (ə, ş, ç, ...). Without
  // this, the cluster inherits the Windows WIN1252 locale and rejects them.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

async function main() {
  if (!existsSync(DATA_DIR)) {
    console.log("embedded-pg: initialising data dir...");
    await pg.initialise();
  }
  await pg.start();
  try {
    await pg.createDatabase("salonbook");
    console.log("embedded-pg: created database 'salonbook'");
  } catch {
    console.log("embedded-pg: database 'salonbook' already exists");
  }
  console.log("embedded-pg: READY on postgresql://postgres:postgres@localhost:5432/salonbook");
}

async function shutdown() {
  console.log("embedded-pg: stopping...");
  try {
    await pg.stop();
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main()
  .then(() => {
    // Keep the process (and thus Postgres) alive.
    setInterval(() => {}, 1 << 30);
  })
  .catch((e) => {
    console.error("embedded-pg: failed to start", e);
    process.exit(1);
  });

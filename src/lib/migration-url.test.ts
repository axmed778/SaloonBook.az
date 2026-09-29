import { describe, it, expect } from "vitest";
import { migrationUrl } from "./migration-url";

const POOLED = "postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require&pgbouncer=true";
const DIRECT = "postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgresql://postgres:postgres@localhost:5432/salonbook?schema=public";

describe("the connection migrations may use", () => {
  it("is Neon's direct endpoint when DIRECT_URL is it", () => {
    expect(migrationUrl({ DATABASE_URL: POOLED, DIRECT_URL: DIRECT })).toEqual({ url: DIRECT });
  });

  it("refuses a DIRECT_URL on the pooler — the leaked advisory lock", () => {
    const r = migrationUrl({ DATABASE_URL: POOLED, DIRECT_URL: POOLED });
    expect("error" in r && r.error).toMatch(/POOLED endpoint/);
  });

  it("refuses a pooler-bound DIRECT_URL even when only pgbouncer=true gives it away", () => {
    const r = migrationUrl({ DIRECT_URL: `${DIRECT}&pgbouncer=true` });
    expect("error" in r).toBe(true);
  });

  it("refuses to fall back to a Neon DATABASE_URL when DIRECT_URL is missing", () => {
    const r = migrationUrl({ DATABASE_URL: POOLED });
    expect("error" in r && r.error).toMatch(/DIRECT_URL is not set/);
    expect("error" in migrationUrl({ DATABASE_URL: POOLED, DIRECT_URL: "  " })).toBe(true);
  });

  it("leaves a local or non-Neon Postgres alone", () => {
    expect(migrationUrl({ DATABASE_URL: LOCAL })).toEqual({ url: LOCAL });
    expect(migrationUrl({ DATABASE_URL: LOCAL, DIRECT_URL: LOCAL })).toEqual({ url: LOCAL });
  });

  it("says so when there is nothing to connect to", () => {
    expect("error" in migrationUrl({})).toBe(true);
  });
});

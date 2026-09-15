import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import az from "../../../messages/az.json";

// NextIntlClientProvider is given an allowlist of namespaces rather than the
// whole catalogue (~80 KB of JSON on every page load, most of it strings only
// the server renders). The cost of that is a list to keep in sync: a client
// component asking for a namespace that is not on it renders raw keys —
// "Payments.todayTitle" in front of a salon owner — and nothing in the unit
// suite noticed, because every test mocks next-intl. Only opening the page did.
//
// So the list is checked here instead: every namespace a "use client" file asks
// for must be on it, and everything on it must exist in the catalogue.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");
const LAYOUT = join(SRC, "app", "[locale]", "layout.tsx");

/**
 * The allowlist, read out of the layout as text. Importing it would mean
 * exporting it from a Next layout file, and pulling a server component with JSX
 * into the unit suite; guard-coverage.test.ts reads the tree the same way.
 */
function clientNamespaces(): string[] {
  const body = /const CLIENT_NAMESPACES = \[([\s\S]*?)\] as const;/.exec(readFileSync(LAYOUT, "utf8"));
  if (!body) throw new Error("CLIENT_NAMESPACES not found in layout.tsx — has it been renamed?");
  // Drop the trailing comments first: several entries carry one, and a comment
  // naming a key ("Settings.location") would otherwise read as an entry.
  const entries = body[1].replace(/\/\/[^\n]*/g, "");
  return [...entries.matchAll(/["'`]([\w.]+)["'`]/g)].map((m) => m[1]);
}

const CLIENT_NAMESPACES = clientNamespaces();

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, keep);
    return keep(path) ? [path] : [];
  });
}

const rel = (path: string) => relative(ROOT, path).split(sep).join("/");
const read = (path: string) => readFileSync(path, "utf8");
const isTest = (path: string) => /\.test\.tsx?$/.test(path);

/** "use client" as the first thing in the file, comments aside. */
function isClientFile(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("//")) continue;
    if (line.startsWith("/*")) {
      while (i < lines.length && !lines[i].includes("*/")) i += 1;
      continue;
    }
    return /^["']use client["'];?$/.test(line);
  }
  return false;
}

const clientFiles = filesUnder(SRC, (p) => /\.tsx?$/.test(p) && !isTest(p) && isClientFile(read(p)));

const CALL = /useTranslations\(/g;
const LITERAL_CALL = /useTranslations\(\s*["'`]([\w.]+)["'`]\s*\)/g;

/** Every useTranslations("X") in a client file, with the file that asks. */
function namespacesAsked(): { ns: string; file: string }[] {
  return clientFiles.flatMap((file) =>
    [...read(file).matchAll(LITERAL_CALL)].map((m) => ({
      // A nested call like useTranslations("Settings.location") is served by its
      // top-level namespace being present.
      ns: m[1].split(".")[0],
      file: rel(file),
    })),
  );
}

/**
 * Calls this file cannot read — useTranslations(ns), or a template with a
 * substitution. The check above works by reading string literals, so such a call
 * would pass silently while asking for a namespace nobody verified. There are
 * none today; if one is added, it needs a different way of being checked, and
 * this says so rather than shrugging.
 */
function countCalls(text: string): { all: number; literal: number } {
  return {
    all: text.match(CALL)?.length ?? 0,
    literal: [...text.matchAll(LITERAL_CALL)].length,
  };
}

function opaqueCalls(): string[] {
  return clientFiles.flatMap((file) => {
    const { all, literal } = countCalls(read(file));
    return all > literal ? [`${rel(file)} (${all - literal} of ${all})`] : [];
  });
}

describe("CLIENT_NAMESPACES", () => {
  const asked = namespacesAsked();

  it("finds the list, the client components and their namespaces, so the checks are not vacuous", () => {
    expect(CLIENT_NAMESPACES.length).toBeGreaterThan(10);
    expect(clientFiles.length).toBeGreaterThan(10);
    expect(asked.map((a) => a.ns)).toContain("Payments");
    expect(asked.map((a) => a.ns)).toContain("Today");
  });

  it("carries every namespace a client component asks for", () => {
    const missing = asked
      .filter((a) => !CLIENT_NAMESPACES.includes(a.ns))
      .map((a) => `${a.ns} (${a.file})`);
    expect([...new Set(missing)]).toEqual([]);
  });

  // Without this, useTranslations(someVariable) is invisible to the check above
  // and ships unverified.
  it("has no call whose namespace this check cannot read", () => {
    expect(opaqueCalls()).toEqual([]);
  });

  it("would actually catch one (the check above is not vacuous)", () => {
    expect(countCalls('const t = useTranslations("Today");')).toEqual({ all: 1, literal: 1 });
    // The shapes that must NOT pass as readable.
    expect(countCalls("const t = useTranslations(ns);")).toEqual({ all: 1, literal: 0 });
    expect(countCalls("const t = useTranslations(`${a}.b`);")).toEqual({ all: 1, literal: 0 });
    expect(countCalls('const t = useTranslations(cond ? "A" : "B");')).toEqual({ all: 1, literal: 0 });
  });

  it("names only namespaces that exist in the catalogue", () => {
    const unknown = CLIENT_NAMESPACES.filter((ns) => !(ns in az));
    expect(unknown).toEqual([]);
  });
});

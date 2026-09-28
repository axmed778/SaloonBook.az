import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import az from "../../../messages/az.json";
import ru from "../../../messages/ru.json";
import en from "../../../messages/en.json";
import { canOpenSection } from "../auth/permissions";
import {
  ENGINE_TARGETS,
  GUIDES,
  GUIDE_SECTIONS,
  guideById,
  guideTargets,
  type GuideDef,
} from "./registry";

// The guide registry is data that points at two other places — the message
// catalogues and the screens' data-tour anchors — and nothing at runtime says
// when either drifts: a missing key renders "Guides.guides.addService…" in the
// card, a renamed anchor leaves a step waiting for an element that never comes.
// Both are checked here.

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SRC = join(ROOT, "src");
const LOCALES = { az, ru, en } as Record<string, Record<string, unknown>>;
const guides = GUIDES as readonly GuideDef[];

function get(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>(
    (o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined),
    obj,
  );
}

function leafKeys(obj: unknown, prefix = ""): string[] {
  if (!obj || typeof obj !== "object") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    leafKeys(v, prefix ? `${prefix}.${k}` : k),
  );
}

function filesUnder(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, keep);
    return keep(path) ? [path] : [];
  });
}

/** Every key a guide's card and the help panel will ask for. */
function requiredKeys(): string[] {
  const keys: string[] = [];
  for (const g of guides) {
    keys.push(`Guides.guides.${g.id}.title`, `Help.sections.${g.section}`);
    for (const s of g.steps) {
      keys.push(`Guides.guides.${g.id}.steps.${s.id}.do`, `Guides.guides.${g.id}.steps.${s.id}.why`);
    }
    if (g.limit) keys.push(`Help.limit.${g.limit}.title`, `Help.limit.${g.limit}.body`);
    if (g.needs) keys.push(`Help.needs.${g.needs.guide}.body`, `Help.needs.${g.needs.guide}.action`);
  }
  return keys;
}

describe("guide registry", () => {
  it("has unique guide ids, and unique step ids within each guide", () => {
    const ids = guides.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const g of guides) {
      const steps = g.steps.map((s) => s.id);
      expect(new Set(steps).size, g.id).toBe(steps.length);
    }
  });

  it("gives every step what its type needs", () => {
    for (const g of guides) {
      expect(g.steps.length, g.id).toBeGreaterThan(0);
      for (const s of g.steps) {
        const at = `${g.id}.${s.id}`;
        if (s.type !== "info") expect(s.target, at).toBeTruthy();
        if (s.type === "navigate") expect(s.route, at).toBeTruthy();
        if (s.awaitRemoval) expect(s.type, at).toBe("click");
        if (s.errorTarget) expect(s.awaitRemoval, at).toBe(true);
      }
      // The last step is the "done" card: reaching it is what counts as finished.
      expect(g.steps[g.steps.length - 1]!.type, g.id).toBe("info");
    }
  });

  it("only sends a person to pages their guide's permission opens", () => {
    for (const g of guides) {
      expect(GUIDE_SECTIONS).toContain(g.section);
      for (const route of [g.route, ...g.steps.flatMap((s) => (s.route ? [s.route] : []))]) {
        expect(route.startsWith("/dashboard"), `${g.id}: ${route}`).toBe(true);
        expect(canOpenSection([g.permission], route), `${g.id}: ${route}`).toBe(true);
      }
    }
  });

  it("names prerequisite guides that exist", () => {
    for (const g of guides) {
      if (g.needs) expect(guideById(g.needs.guide), g.id).toBeDefined();
    }
  });
});

describe("guide texts", () => {
  it("exist in every locale, as short plain sentences", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      for (const key of requiredKeys()) {
        const value = get(messages, key);
        expect(typeof value, `${locale}: ${key}`).toBe("string");
        expect((value as string).trim(), `${locale}: ${key}`).not.toBe("");
        // One action and one reason per step, not a paragraph.
        if (/\.steps\./.test(key)) expect((value as string).length, `${locale}: ${key}`).toBeLessThanOrEqual(140);
      }
    }
  });

  it("have the same keys in az, ru and en", () => {
    for (const ns of ["Guides", "Help"]) {
      const base = leafKeys(get(az, ns)).sort();
      expect(base.length, ns).toBeGreaterThan(0);
      expect(leafKeys(get(ru, ns)).sort(), `ru ${ns}`).toEqual(base);
      expect(leafKeys(get(en, ns)).sort(), `en ${ns}`).toEqual(base);
    }
  });

  it("carry no step texts for steps the registry no longer has", () => {
    const expected = new Set(requiredKeys().filter((k) => k.startsWith("Guides.guides.")));
    const present = leafKeys(get(az, "Guides.guides"), "Guides.guides");
    expect(present.filter((k) => !expected.has(k))).toEqual([]);
  });
});

describe("guide anchors", () => {
  const anchors = new Set(
    filesUnder(SRC, (p) => /\.tsx$/.test(p) && !/\.test\.tsx$/.test(p)).flatMap((file) =>
      // data-tour="x" on an element, or tour: "x" in a menu table that renders it.
      [...readFileSync(file, "utf8").matchAll(/data-tour="([^"]+)"|\btour: "([^"]+)"/g)].map(
        (m) => m[1] ?? m[2]!,
      ),
    ),
  );

  it("finds anchors in the source, so the check below is not vacuous", () => {
    expect(anchors.size).toBeGreaterThan(10);
  });

  it("point at a data-tour attribute that exists in src/", () => {
    const missing = [...guideTargets(), ...ENGINE_TARGETS, "help.fab"].filter((t) => !anchors.has(t));
    expect(missing).toEqual([]);
  });
});

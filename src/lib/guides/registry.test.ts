import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import az from "../../../messages/az.json";
import ru from "../../../messages/ru.json";
import en from "../../../messages/en.json";
import { canOpenSection } from "../auth/permissions";
import { SETUP_ITEMS } from "./checklist";
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
    for (const n of g.needs ?? []) keys.push(`Help.needs.${g.id}.${n.fact}`, `Help.showGuide.${n.guide}`);
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
        if (s.awaitRemoval || s.successTarget) expect(s.type, at).toBe("click");
        // One way to know the save worked, and an error line only beside one.
        expect(!!(s.awaitRemoval && s.successTarget), at).toBe(false);
        if (s.errorTarget) expect(!!(s.awaitRemoval || s.successTarget), at).toBe(true);
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
        expect(canOpenSection(g.permissions, route), `${g.id}: ${route}`).toBe(true);
      }
    }
  });

  it("names prerequisite guides that exist, and are not the guide itself", () => {
    for (const g of guides) {
      for (const n of g.needs ?? []) {
        expect(guideById(n.guide), `${g.id} needs ${n.guide}`).toBeDefined();
        expect(n.guide, g.id).not.toBe(g.id);
      }
    }
  });

  it("asks for at least one permission per guide", () => {
    for (const g of guides) expect(g.permissions.length, g.id).toBeGreaterThan(0);
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
    for (const ns of ["Guides", "Help", "Onboarding"]) {
      const base = leafKeys(get(az, ns)).sort();
      expect(base.length, ns).toBeGreaterThan(0);
      expect(leafKeys(get(ru, ns)).sort(), `ru ${ns}`).toEqual(base);
      expect(leafKeys(get(en, ns)).sort(), `en ${ns}`).toEqual(base);
    }
  });

  it("have a title and a hint for every checklist item, in every locale", () => {
    for (const [locale, messages] of Object.entries(LOCALES)) {
      for (const item of SETUP_ITEMS) {
        for (const leaf of ["title", "hint"]) {
          const key = `Onboarding.checklist.items.${item.id}.${leaf}`;
          expect(typeof get(messages, key), `${locale}: ${key}`).toBe("string");
        }
      }
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
      // data-tour="x" on an element; data-tour={ok ? "x" : "y"} choosing between
      // literals; or tour: "x" in a menu table that renders it.
      [...readFileSync(file, "utf8").matchAll(/data-tour="([^"]+)"|data-tour=\{([^}]*)\}|\btour: "([^"]+)"/g)].flatMap(
        (m) => (m[2] !== undefined ? [...m[2].matchAll(/"([^"]+)"/g)].map((q) => q[1]!) : [m[1] ?? m[3]!]),
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

describe("the analytics SQL (docs/guides-analytics.sql)", () => {
  it("names every step exactly as the registry does", () => {
    const sql = readFileSync(join(ROOT, "docs", "guides-analytics.sql"), "utf8");
    const inSql = [...sql.matchAll(/^\s*\('(\w+)', (\d+), '(\w+)'\)/gm)].map((m) => `${m[1]}#${m[2]}#${m[3]}`);
    const inRegistry = guides.flatMap((g) => g.steps.map((s, i) => `${g.id}#${i}#${s.id}`));
    expect(inSql).toEqual(inRegistry);
  });
});


import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildDigestSystemPrompt } from "./ig-digest";
// The loader lives in worker/ on purpose — it does fs, and src/lib must stay
// importable by the dashboard page. Tested from here because `pnpm test` runs
// `vitest run src`.
import { assertPlaybookUsable, loadDmPlaybook } from "../../worker/playbook";

// docs/dm-playbook.md is the single source of truth for every digest draft, and
// the worker reads it from disk (worker/playbook.ts). That makes it a build
// artefact in everything but name: rename it, move it, or drop a section the
// prompt points at, and the failure surfaces once a day, in production, as
// freestyle drafts or a failed run. This test is the guard.

const PLAYBOOK_PATH = fileURLToPath(new URL("../../docs/dm-playbook.md", import.meta.url));
const playbook = readFileSync(PLAYBOOK_PATH, "utf8");

/** Every scenario the system prompt names by number must exist in the file. */
const REFERENCED_SCENARIOS = [
  "1.10", // non-target lead → skip
  "2.1", // tariff after the master count
  "4.6", // the [где: ПРОВЕРЬ] case
  "7.0", // the onboarding message
  "7.4", // trial day 3
  "7.9", // trial extension
  "8.1", // follow-up day 1
  "8.2", // day 2
  "8.3", // day 4
  "8.4", // day 7, last touch
  "8.5", // reactivation at 3 weeks
  "9.4", // spam → skip
];

describe("docs/dm-playbook.md", () => {
  it("is present and whole", () => {
    expect(playbook).toContain("# SalonBook — DM Playbook");
    // The loader refuses anything under 10_000 bytes as truncated.
    expect(playbook.length).toBeGreaterThan(10_000);
  });

  it.each(REFERENCED_SCENARIOS)("still has the scenario %s the prompt routes to", (n) => {
    expect(playbook).toContain(`### ${n}`);
  });

  it("still states the 14-day trial the prompt repeats", () => {
    expect(playbook).toContain("14 gün pulsuz");
  });

  it("still carries the target-niche carve-out the prompt repeats", () => {
    // If this line ever moves out of the playbook, the prompt's "лазер,
    // косметолог, брови, ресницы — ЦЕЛЕВЫЕ" rule loses its source.
    expect(playbook).toContain("Лазер, косметолог, брови, ресницы — это ЦЕЛЕВЫЕ");
  });

  it("goes into the system prompt whole, inside the playbook tags", () => {
    const prompt = buildDigestSystemPrompt(playbook);
    expect(prompt).toContain(`<playbook>\n${playbook}\n</playbook>`);
    // Nothing truncates it on the way in: the file's very last section has to be
    // in the prompt too, not just its opening.
    expect(prompt).toContain("## 10. После каждого диалога");
  });
});

describe("loadDmPlaybook", () => {
  it("reads the real file and caches it", () => {
    const first = loadDmPlaybook();
    expect(first).toBe(playbook);
    // Same string object on the second call: read once per process, not once per
    // digest — though at one run a day the caching is for tidiness, not speed.
    expect(loadDmPlaybook()).toBe(first);
  });

  it("refuses a truncated playbook rather than producing freestyle drafts", () => {
    expect(() => assertPlaybookUsable("# SalonBook — DM Playbook\nтолько заголовок")).toThrow(
      /only \d+ bytes/,
    );
  });

  it("refuses a file of the right size that is not the playbook", () => {
    expect(() => assertPlaybookUsable("x".repeat(20_000))).toThrow(/not the DM playbook/);
  });

  it("accepts the real file", () => {
    expect(() => assertPlaybookUsable(playbook)).not.toThrow();
  });
});

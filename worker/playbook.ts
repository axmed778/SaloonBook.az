import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// The DM playbook, read from docs/dm-playbook.md at runtime.
//
// Why a file read rather than a string baked into a .ts module: the playbook is
// the founder's own working document — the thing they edit when a price or a
// scenario changes — and a second copy inside the source would drift from it
// within a week. One file, read as-is, is what makes "the playbook is the single
// source of truth for drafts" true in the code and not just in a comment.
//
// It lives in the worker rather than src/lib because src/lib/ig-digest.ts is
// deliberately side-effect free (the dashboard page imports it, so `fs` must not
// reach the web bundle). The pure half shapes the prompt; this hands it the text.
// ---------------------------------------------------------------------------

/** Resolved from this module, not from cwd: the worker's cwd is not guaranteed. */
const PLAYBOOK_PATH = fileURLToPath(new URL("../docs/dm-playbook.md", import.meta.url));

/**
 * A sanity floor, not a real size check. A playbook truncated to a few hundred
 * bytes would still produce a plausible-looking prompt whose drafts were quietly
 * freestyle, which is the one failure worth catching before a paid Claude call.
 */
const MIN_PLAYBOOK_BYTES = 10_000;

/**
 * Reject a playbook that is present but not usable. Separate from the read so it
 * can be tested without touching the filesystem.
 */
export function assertPlaybookUsable(text: string, path = PLAYBOOK_PATH): void {
  if (text.length < MIN_PLAYBOOK_BYTES) {
    throw new Error(
      `DM playbook at ${path} is only ${text.length} bytes — expected at least ${MIN_PLAYBOOK_BYTES}; refusing to build drafts from a truncated playbook`,
    );
  }
  // A file of the right size that is not the playbook (a stray README, a
  // half-written replacement) would pass the byte check and produce drafts with
  // no scenario numbers at all.
  if (!text.includes("# SalonBook — DM Playbook")) {
    throw new Error(`File at ${path} is not the DM playbook — its title line is missing`);
  }
}

let cached: string | null = null;

/**
 * The playbook text, read once per process.
 *
 * THROWS if the file is missing or unusable, and that is deliberate: every draft
 * is supposed to come from a numbered scenario, so a run without the playbook
 * would invent its own texts — worse than no digest at all. runIgDigest catches
 * it, logs "[ig-digest] failed: generate — …", and the page keeps yesterday's
 * list.
 */
export function loadDmPlaybook(): string {
  if (cached !== null) return cached;

  let text: string;
  try {
    text = readFileSync(PLAYBOOK_PATH, "utf8");
  } catch (e) {
    throw new Error(
      `DM playbook is unreadable at ${PLAYBOOK_PATH} — drafts must come from it, so the digest cannot run: ${
        e instanceof Error ? e.message : String(e)
      }`,
      { cause: e },
    );
  }

  assertPlaybookUsable(text);
  cached = text;
  return cached;
}

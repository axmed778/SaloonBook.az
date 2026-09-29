// The running guide's position, kept in the browser so a guide survives a page
// reload (and the full reloads an installed PWA does on resume).
//
// Deliberately not in the database: the position lives for minutes, changes on
// every step, and is worthless on another device. What outlives the run —
// finished guides — is written to UserGuideState by the server action.
//
// Keyed by user, so a shared salon tablet never resumes one person's guide for
// the next one who signs in. Every access is wrapped: storage can be missing or
// throw (private mode, blocked site data), and the guide then simply does not
// resume.

export interface StoredRun {
  guideId: string;
  step: number;
  /** Steps whose "element not found" was already reported, so a retry does not report it twice. */
  notFound: number[];
  /** "completed" was already reported (the last step was reached). */
  completed: boolean;
  /** Epoch ms of the last change. A run idle for longer than RESUME_WINDOW_MS is dropped. */
  at: number;
}

export const RESUME_WINDOW_MS = 60 * 60 * 1000;

const key = (userId: string) => `sb_guide_run:${userId}`;

/**
 * What a stored value holds, as data: a run to resume, one left idle past the
 * resume window (reported as abandoned, "timeout" — the tab was closed or the
 * person walked away mid-guide), or nothing usable. PURE, for the tests.
 */
export function classifyRun(
  raw: string | null,
  now: number,
): { run: StoredRun } | { expired: StoredRun } | null {
  if (!raw) return null;
  let parsed: Partial<StoredRun>;
  try {
    parsed = JSON.parse(raw) as Partial<StoredRun>;
  } catch {
    return null;
  }
  if (typeof parsed.guideId !== "string" || typeof parsed.step !== "number" || typeof parsed.at !== "number") {
    return null;
  }
  const run: StoredRun = {
    guideId: parsed.guideId,
    step: parsed.step,
    notFound: Array.isArray(parsed.notFound) ? parsed.notFound.filter((n) => typeof n === "number") : [],
    completed: parsed.completed === true,
    at: parsed.at,
  };
  return now - run.at > RESUME_WINDOW_MS ? { expired: run } : { run };
}

/**
 * The run stored for this user. An expired one is removed and handed back as
 * `expired`, so the caller can report where it was left.
 */
export function readRun(userId: string, now = Date.now()): { run: StoredRun | null; expired: StoredRun | null } {
  try {
    const found = classifyRun(localStorage.getItem(key(userId)), now);
    if (!found) {
      localStorage.removeItem(key(userId));
      return { run: null, expired: null };
    }
    if ("expired" in found) {
      localStorage.removeItem(key(userId));
      return { run: null, expired: found.expired };
    }
    return { run: found.run, expired: null };
  } catch {
    return { run: null, expired: null };
  }
}

export function writeRun(userId: string, run: StoredRun | null): void {
  try {
    if (run) localStorage.setItem(key(userId), JSON.stringify(run));
    else localStorage.removeItem(key(userId));
  } catch {
    /* the guide just won't survive a reload */
  }
}

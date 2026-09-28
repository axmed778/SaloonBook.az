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

export function readRun(userId: string, now = Date.now()): StoredRun | null {
  try {
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const run = JSON.parse(raw) as Partial<StoredRun>;
    if (
      typeof run.guideId !== "string" ||
      typeof run.step !== "number" ||
      typeof run.at !== "number" ||
      now - run.at > RESUME_WINDOW_MS
    ) {
      localStorage.removeItem(key(userId));
      return null;
    }
    return {
      guideId: run.guideId,
      step: run.step,
      notFound: Array.isArray(run.notFound) ? run.notFound.filter((n) => typeof n === "number") : [],
      completed: run.completed === true,
      at: run.at,
    };
  } catch {
    return null;
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

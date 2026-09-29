import { describe, it, expect } from "vitest";
import { classifyRun, RESUME_WINDOW_MS } from "./guide-storage";

// What a stored guide position means on the next load: resume it, report it as
// abandoned ("timeout"), or ignore it.

const run = { guideId: "addService", step: 3, notFound: [], completed: false, at: 1_000_000 };
const raw = (v: unknown) => JSON.stringify(v);

describe("a stored guide position", () => {
  it("resumes within the window", () => {
    expect(classifyRun(raw(run), run.at + RESUME_WINDOW_MS)).toEqual({ run });
  });

  it("is handed back as expired after it, with its step, for the timeout report", () => {
    expect(classifyRun(raw(run), run.at + RESUME_WINDOW_MS + 1)).toEqual({ expired: run });
  });

  it("keeps whether it was already completed (no timeout report then)", () => {
    const done = { ...run, completed: true };
    expect(classifyRun(raw(done), done.at + RESUME_WINDOW_MS + 1)).toEqual({ expired: done });
  });

  it("ignores nothing, junk and half-written values", () => {
    expect(classifyRun(null, 0)).toBeNull();
    expect(classifyRun("{not json", 0)).toBeNull();
    expect(classifyRun(raw({ guideId: "addService" }), 0)).toBeNull();
  });

  it("drops a malformed notFound list rather than trusting it", () => {
    expect(classifyRun(raw({ ...run, notFound: "x" }), run.at)).toEqual({ run: { ...run, notFound: [] } });
  });
});

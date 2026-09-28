"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { GuideEntry } from "@/lib/guides/availability";
import { guideById, type GuideDef, type GuideId } from "@/lib/guides/registry";
import { recordGuideEvent, type GuideEventInput } from "@/app/[locale]/dashboard/_actions/guides";
import { readRun, writeRun, type StoredRun } from "./guide-storage";
import { GuideOverlay } from "./guide-overlay";

// The running guide: which one, which step, and the moves between steps. The
// list of guides this person may run arrives from the server (the dashboard
// layout computes it); this only ever starts one the server marked "ready".
//
// Lives in DashboardShell, above every page, so a guide carries on across route
// changes; guide-storage.ts carries it across a reload.

interface GuideContextValue {
  /** The server's list, with guides finished in this visit marked done. */
  catalog: GuideEntry[];
  /** The running guide, or null. */
  runningId: GuideId | null;
  start: (id: GuideId) => void;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuides(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuides() outside GuideProvider");
  return ctx;
}

function send(event: GuideEventInput) {
  // Analytics must never cost the person anything: no await, no error shown.
  recordGuideEvent(event).catch(() => {});
}

export function GuideProvider({
  userId,
  catalog,
  children,
}: {
  userId: string;
  catalog: GuideEntry[];
  children: React.ReactNode;
}) {
  const [run, setRun] = useState<StoredRun | null>(null);
  const [doneNow, setDoneNow] = useState<string[]>([]);
  // The latest run, for callbacks fired from DOM listeners and timers.
  const runRef = useRef<StoredRun | null>(null);
  runRef.current = run;

  const ready = useCallback(
    (id: string) => catalog.some((g) => g.id === id && g.state === "ready"),
    [catalog],
  );

  // Resume after a reload — only a guide the server still offers as ready.
  useEffect(() => {
    const stored = readRun(userId);
    const guide = stored && guideById(stored.guideId);
    if (stored && guide && ready(stored.guideId) && stored.step < guide.steps.length) {
      setRun(stored);
    } else if (stored) {
      writeRun(userId, null);
    }
    // Mount only: a later catalog change must not restart a finished run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    writeRun(userId, run);
  }, [userId, run]);

  const guide: GuideDef | undefined = run ? guideById(run.guideId) : undefined;

  // Reaching the last step is finishing: its "done" card only says so, and
  // closing it must not read as giving up.
  useEffect(() => {
    if (!run || !guide || run.completed) return;
    if (run.step !== guide.steps.length - 1) return;
    send({ guideId: run.guideId, event: "completed", step: run.step, reason: null });
    setDoneNow((d) => [...d, run.guideId]);
    setRun({ ...run, completed: true, at: Date.now() });
  }, [run, guide]);

  const start = useCallback(
    (id: GuideId) => {
      if (!ready(id)) return;
      const current = runRef.current;
      if (current && !current.completed) {
        send({ guideId: current.guideId, event: "abandoned", step: current.step, reason: "exit" });
      }
      send({ guideId: id, event: "started", step: 0, reason: null });
      setRun({ guideId: id, step: 0, notFound: [], completed: false, at: Date.now() });
    },
    [ready],
  );

  /** Move on from `from`. Ignored when the run has already moved (a click and a blur both firing). */
  const next = useCallback((from: number) => {
    setRun((r) => {
      if (!r || r.step !== from) return r;
      const g = guideById(r.guideId);
      if (!g || from >= g.steps.length - 1) return null; // "Done" on the last step
      return { ...r, step: from + 1, at: Date.now() };
    });
  }, []);

  const back = useCallback((from: number, to: number) => {
    setRun((r) => (r && r.step === from && to >= 0 && to < from ? { ...r, step: to, at: Date.now() } : r));
  }, []);

  const exit = useCallback(() => {
    const r = runRef.current;
    if (!r) return;
    if (!r.completed) send({ guideId: r.guideId, event: "abandoned", step: r.step, reason: "exit" });
    setRun(null);
  }, []);

  // Reported once per step per run: the fallback's "try again" can time out
  // again without counting twice.
  const notFound = useCallback((step: number) => {
    const r = runRef.current;
    if (!r || r.step !== step || r.notFound.includes(step)) return;
    send({ guideId: r.guideId, event: "abandoned", step, reason: "not_found" });
    setRun({ ...r, notFound: [...r.notFound, step], at: Date.now() });
  }, []);

  const value = useMemo<GuideContextValue>(
    () => ({
      catalog: catalog.map((g) => (doneNow.includes(g.id) ? { ...g, completed: true } : g)),
      runningId: (run?.guideId as GuideId | undefined) ?? null,
      start,
    }),
    [catalog, doneNow, run?.guideId, start],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {run && guide && (
        <GuideOverlay
          key={`${run.guideId}:${run.step}`}
          guide={guide}
          stepIndex={run.step}
          onNext={next}
          onBack={back}
          onExit={exit}
          onNotFound={notFound}
        />
      )}
    </GuideContext.Provider>
  );
}

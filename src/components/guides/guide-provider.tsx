"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { GuideEntry } from "@/lib/guides/availability";
import type { SetupState } from "@/lib/guides/checklist";
import { guideById, type GuideDef, type GuideId } from "@/lib/guides/registry";
import {
  markWelcomeShown,
  setChecklistHidden,
} from "@/app/[locale]/dashboard/_actions/guides";
import type { GuideEventInput } from "@/lib/guides/events";
import { useRouter } from "@/i18n/navigation";
import { readRun, writeRun, type StoredRun } from "./guide-storage";
import { GuideOverlay } from "./guide-overlay";
import { WelcomeDialog } from "./welcome-dialog";

// The running guide: which one, which step, and the moves between steps. The
// list of guides this person may run arrives from the server (the dashboard
// layout computes it); this only ever starts one the server marked "ready".
//
// Lives in DashboardShell, above every page, so a guide carries on across route
// changes; guide-storage.ts carries it across a reload.
//
// It also holds the first-run checklist and welcome the server computed, with
// the person's own moves on top (hide, collapse, close the welcome) applied at
// once while the server catches up.

interface GuideContextValue {
  /** The server's list, with guides finished in this visit marked done. */
  catalog: GuideEntry[];
  /** The running guide, or null. */
  runningId: GuideId | null;
  start: (id: GuideId) => void;
  /** The first-run checklist, or null when it is not this person's or all done. */
  setup: SetupState | null;
  /** The salon's public booking link, for the checklist's "Copy". */
  bookingUrl: string | null;
  /** The checklist folded to its header (a per-browser preference). */
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  /** Skip the checklist; the help panel brings it back. */
  hideChecklist: () => void;
  /** Bring the checklist back, unfolded, and scroll it into view on Today. */
  openChecklist: () => void;
  /** Bumped by openChecklist(), so the checklist knows to scroll itself into view. */
  checklistFocus: number;
}

const GuideContext = createContext<GuideContextValue | null>(null);

export function useGuides(): GuideContextValue {
  const ctx = useContext(GuideContext);
  if (!ctx) throw new Error("useGuides() outside GuideProvider");
  return ctx;
}

/** For a page that renders with or without help (the provider is absent while it is off). */
export function useGuidesOptional(): GuideContextValue | null {
  return useContext(GuideContext);
}

const collapsedKey = (userId: string) => `sb_setup_collapsed:${userId}`;
const pendingHiddenKey = (userId: string) => `sb_setup_hidden_pending:${userId}`;

function readPendingHidden(userId: string): boolean | null {
  try {
    const v = localStorage.getItem(pendingHiddenKey(userId));
    return v === "1" ? true : v === "0" ? false : null;
  } catch {
    return null;
  }
}

function writePendingHidden(userId: string, hidden: boolean | null): void {
  try {
    if (hidden === null) localStorage.removeItem(pendingHiddenKey(userId));
    else localStorage.setItem(pendingHiddenKey(userId), hidden ? "1" : "0");
  } catch {
    /* no storage: the plain request is all there is */
  }
}

const EVENTS_URL = "/api/dashboard/guide-events";

function send(event: GuideEventInput) {
  // Analytics must never cost the person anything: no await, no error shown.
  // A beacon, because the page usually changes right after (opening a guide is
  // a click, then a navigation), and a beacon is delivered anyway.
  const body = JSON.stringify(event);
  try {
    if (navigator.sendBeacon?.(EVENTS_URL, new Blob([body], { type: "text/plain" }))) return;
  } catch {
    /* fall through */
  }
  fetch(EVENTS_URL, { method: "POST", body, keepalive: true, credentials: "same-origin" }).catch(() => {});
}

export function GuideProvider({
  userId,
  catalog,
  setup: serverSetup = null,
  bookingUrl = null,
  children,
}: {
  userId: string;
  catalog: GuideEntry[];
  setup?: SetupState | null;
  bookingUrl?: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [run, setRun] = useState<StoredRun | null>(null);
  // The person's hide/show, until the server's next render says the same.
  const [hiddenOverride, setHiddenOverride] = useState<boolean | null>(null);
  const [welcomeClosed, setWelcomeClosed] = useState(false);
  const [collapsed, setCollapsedState] = useState(false);
  const [checklistFocus, setChecklistFocus] = useState(0);
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
    const { run: stored, expired } = readRun(userId);
    // Left mid-guide and never came back within the hour (a closed tab, a
    // phone put away): report where, as an abandon of its own kind.
    if (expired && !expired.completed && guideById(expired.guideId)) {
      send({ guideId: expired.guideId, event: "abandoned", step: expired.step, reason: "timeout" });
    }
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

  // ── First-run checklist and welcome ───────────────────────────────────────
  useEffect(() => {
    try {
      setCollapsedState(localStorage.getItem(collapsedKey(userId)) === "1");
    } catch {
      /* unfolded, then */
    }
  }, [userId]);

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      try {
        localStorage.setItem(collapsedKey(userId), next ? "1" : "0");
      } catch {
        /* just not remembered */
      }
    },
    [userId],
  );

  // Once the server's value arrives, it is the truth again.
  const serverHidden = serverSetup?.hidden;
  useEffect(() => {
    setHiddenOverride(null);
  }, [serverHidden]);

  // Hide / bring back must survive a reload or a tab closed right after the
  // press: a server action in flight is simply aborted then, and the change was
  // lost. So the intent is written to the browser first, sent, and cleared once
  // the server has it; a load that finds one still pending applies it and sends
  // it again. (Declared after the effect above, so this override wins at mount.)
  const sendHidden = useCallback(
    (hidden: boolean) => {
      writePendingHidden(userId, hidden);
      setChecklistHidden(hidden)
        .then(() => writePendingHidden(userId, null))
        .catch(() => {
          /* stays pending: retried on the next load */
        });
    },
    [userId],
  );

  useEffect(() => {
    const pending = readPendingHidden(userId);
    if (pending === null) return;
    if (pending === serverHidden) {
      writePendingHidden(userId, null);
      return;
    }
    setHiddenOverride(pending);
    sendHidden(pending);
    // Mount only: a pending intent is replayed once per load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const effectiveHidden = hiddenOverride ?? serverHidden ?? false;

  const hideChecklist = useCallback(() => {
    setHiddenOverride(true);
    sendHidden(true);
  }, [sendHidden]);

  const openChecklist = useCallback(() => {
    setHiddenOverride(false);
    setCollapsed(false);
    setChecklistFocus((n) => n + 1);
    if (effectiveHidden) sendHidden(false);
    router.push("/dashboard");
  }, [effectiveHidden, sendHidden, setCollapsed, router]);

  const setup = useMemo<SetupState | null>(
    () => (serverSetup ? { ...serverSetup, hidden: hiddenOverride ?? serverSetup.hidden } : null),
    [serverSetup, hiddenOverride],
  );

  const closeWelcome = useCallback(
    (thenOpen: boolean) => {
      setWelcomeClosed(true);
      markWelcomeShown().catch(() => {});
      if (thenOpen) openChecklist();
    },
    [openChecklist],
  );

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
      setup,
      bookingUrl,
      collapsed,
      setCollapsed,
      hideChecklist,
      openChecklist,
      checklistFocus,
    }),
    [catalog, doneNow, run?.guideId, start, setup, bookingUrl, collapsed, setCollapsed, hideChecklist, openChecklist, checklistFocus],
  );

  return (
    <GuideContext.Provider value={value}>
      {children}
      {/* Never over a running guide; the server already keeps it off the consent gate. */}
      {setup?.welcome && !welcomeClosed && !run && (
        <WelcomeDialog total={setup.total} onStart={() => closeWelcome(true)} onLater={() => closeWelcome(false)} />
      )}
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

"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

// Replacement for native alert() on list-level action errors: a transient
// bottom-center toast in the dashboard palette. Caller holds the message in
// state; the toast self-dismisses.
export function ErrorToast({
  message,
  onClose,
  durationMs = 5000,
}: {
  message: string;
  onClose: () => void;
  durationMs?: number;
}) {
  const t = useTranslations("Common");
  useEffect(() => {
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [onClose, durationMs]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-rose-500/40 bg-[#18090d] px-4 py-3 text-sm text-rose-800 dark:text-rose-100 shadow-2xl"
      >
        <span className="min-w-0">{message}</span>
        <button
          onClick={onClose}
          aria-label={t("close")}
          title={t("close")}
          className="shrink-0 text-rose-700 dark:text-rose-300/70 transition hover:text-rose-100"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

// The neutral sibling of ErrorToast: confirms an action that already happened
// and offers to take it back for a few seconds. Same placement and lifecycle —
// the caller holds it in state and passes a stable onClose.
export function UndoToast({
  message,
  undoLabel,
  onUndo,
  onClose,
  durationMs = 6000,
}: {
  message: string;
  undoLabel: string;
  onUndo: () => void;
  onClose: () => void;
  durationMs?: number;
}) {
  const t = useTranslations("Common");
  useEffect(() => {
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [onClose, durationMs]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        role="status"
        className="pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground shadow-2xl"
      >
        <span className="min-w-0">{message}</span>
        <button
          onClick={onUndo}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground transition hover:bg-muted"
        >
          {undoLabel}
        </button>
        <button
          onClick={onClose}
          aria-label={t("close")}
          title={t("close")}
          className="shrink-0 text-muted-foreground transition hover:text-foreground"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

"use client";

import { useEffect } from "react";

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
  useEffect(() => {
    const t = setTimeout(onClose, durationMs);
    return () => clearTimeout(t);
  }, [onClose, durationMs]);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex justify-center px-4">
      <div
        role="alert"
        className="pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border border-rose-500/40 bg-[#18090d] px-4 py-3 text-sm text-rose-100 shadow-2xl"
      >
        <span className="min-w-0">{message}</span>
        <button
          onClick={onClose}
          aria-label="Bağla"
          title="Bağla"
          className="shrink-0 text-rose-300/70 transition hover:text-rose-100"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
}

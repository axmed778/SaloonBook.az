"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { minutesToHHMM } from "@/lib/time";
import { setAppointmentStatus } from "../actions";
import type { CalendarBlock } from "./calendar-shared";

// "Close day" reconciliation. Past CONFIRMED appointments the salon hasn't closed
// (completed / no-show) block a clean day: this bar surfaces them and lets staff
// resolve each inline, so realized revenue and payroll reflect what actually
// happened. The 48h worker sweep (reconcile.ts) is the fallback for days never
// closed by hand.
export function ReconcileBar({ blocks }: { blocks: CalendarBlock[] }) {
  const t = useTranslations("Calendar");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const overdue = blocks
    .filter((b) => b.overdue)
    .sort((a, b) => a.startMin - b.startMin);

  // Nothing to reconcile and the dialog isn't open → render nothing.
  if (overdue.length === 0 && !open) return null;

  function resolve(id: string, status: "COMPLETED" | "NO_SHOW") {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const res = await setAppointmentStatus({ id, status });
      setBusyId(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {overdue.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3">
          <p className="text-sm font-medium text-violet-900 dark:text-violet-100">
            {t("reconcile.pending", { count: overdue.length })}
          </p>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="shrink-0 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-violet-500"
          >
            {t("reconcile.closeDay")}
          </button>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">{t("reconcile.title")}</h2>
                <p className="mt-1 text-xs text-faint-foreground">{t("reconcile.hint")}</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

            {overdue.length === 0 ? (
              <p className="mt-6 mb-2 text-center text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                {t("reconcile.done")}
              </p>
            ) : (
              <ul className="mt-4 max-h-[55vh] space-y-2 overflow-y-auto">
                {overdue.map((b) => (
                  <li key={b.id} className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="truncate text-sm font-medium text-foreground">
                      {minutesToHHMM(b.startMin)} · {b.subtitle}
                    </p>
                    <p className="truncate text-xs text-faint-foreground">
                      {b.title} · {b.employeeName}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={pending && busyId === b.id}
                        onClick={() => resolve(b.id, "COMPLETED")}
                        className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-sm font-medium text-emerald-800 dark:text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        {t("popup.complete")}
                      </button>
                      <button
                        type="button"
                        disabled={pending && busyId === b.id}
                        onClick={() => resolve(b.id, "NO_SHOW")}
                        className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-sm font-medium text-amber-800 dark:text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
                      >
                        {t("popup.markNoShow")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

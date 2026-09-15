"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { addTimeOff, deleteTimeOff } from "../workers/actions";
import { bakuToday } from "@/lib/time";

export type TimeOffRow = { id: string; label: string; reason: string | null };

const inputCls =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

// --- Time off modal -----------------------------------------------------------
// Whole-day ranges; booked slots inside the range stay booked (the engine only
// blocks NEW bookings), so the salon should resolve conflicts manually.
//
// Opened from the Staff screen and from the Time off screen. `canEdit` hides the
// form and the delete buttons for a role that may only read the schedule; the
// actions refuse such a role either way.

export function TimeOffModal({
  employee,
  canEdit,
  onClose,
}: {
  employee: { id: string; name: string; timeOff: TimeOffRow[] };
  canEdit: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("Workers");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // Baku day, not the browser's UTC day: between midnight and 04:00 local time
  // toISOString() still returns YESTERDAY, so the picker offered a past date.
  const today = bakuToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!from || !to) return setError(t("timeOffModal.errors.selectDates"));
    if (to < from) return setError(t("timeOffModal.errors.endBeforeStart"));
    startTransition(async () => {
      const res = await addTimeOff({
        employeeId: employee.id,
        from,
        to,
        reason: reason.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setReason("");
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const res = await deleteTimeOff(id);
      if (!res.ok) setError(res.error);
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {t("timeOffModal.titleFor", { name: employee.name })}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")} title={tc("close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        {canEdit && (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{t("timeOffModal.start")}</label>
                <input
                  type="date"
                  className={inputCls + " w-full"}
                  value={from}
                  min={today}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    if (to < e.target.value) setTo(e.target.value);
                  }}
                />
              </div>
              <div>
                <label className={labelCls}>{t("timeOffModal.endInclusive")}</label>
                <input
                  type="date"
                  className={inputCls + " w-full"}
                  value={to}
                  min={from}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label className={labelCls}>{t("timeOffModal.reason")}</label>
              <input
                className={inputCls + " w-full"}
                placeholder={t("timeOffModal.reasonPlaceholder")}
                maxLength={200}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-rose-700 dark:text-rose-400">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-700 disabled:opacity-60"
            >
              {pending ? t("timeOffModal.adding") : t("timeOffModal.add")}
            </button>
          </form>
        )}

        <div className={canEdit ? "mt-5 border-t border-border pt-4" : "mt-4"}>
          <p className="text-xs font-medium text-faint-foreground">{t("timeOffModal.current")}</p>
          {employee.timeOff.length === 0 ? (
            <p className="mt-2 text-sm text-faint-foreground">{t("timeOffModal.none")}</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {employee.timeOff.map((row) => (
                <li
                  key={row.id}
                  className="flex items-center justify-between gap-3 rounded-lg bg-muted px-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate text-secondary-foreground">
                    {row.label}
                    {row.reason && <span className="text-faint-foreground"> · {row.reason}</span>}
                  </span>
                  {canEdit && (
                    <button
                      onClick={() => remove(row.id)}
                      disabled={pending}
                      className="shrink-0 text-xs text-faint-foreground transition hover:text-rose-400"
                    >
                      {t("delete")}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!canEdit && error && <p className="mt-2 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
          <p className="mt-3 text-xs text-faint-foreground">
            {t("timeOffModal.note")}
          </p>
        </div>
      </div>
    </div>
  );
}

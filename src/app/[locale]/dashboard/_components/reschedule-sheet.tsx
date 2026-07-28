"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { rescheduleSlots, rescheduleAppointment } from "../actions";
import type { Slot } from "@/lib/availability";
import { bakuToday, shiftYmd, formatBakuDate } from "@/lib/time";
import type { TodayAppointment } from "./today-view";

// Bottom sheet (mobile) / centred dialog (desktop) for moving an appointment to
// another free slot. Reuses the existing rescheduleSlots + rescheduleAppointment
// server actions, so availability, overlap and notifications match the calendar.
export function RescheduleSheet({
  appt,
  onClose,
  onDone,
}: {
  appt: TodayAppointment;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("Today");
  const locale = useLocale();
  const today = bakuToday();
  const [day, setDay] = useState(today);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void rescheduleSlots({ id: appt.id, day }).then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setSlots(res.slots);
      } else {
        setSlots([]);
        setError(res.error);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [appt.id, day]);

  async function pick(slot: Slot) {
    setSaving(true);
    setError(null);
    const res = await rescheduleAppointment({ id: appt.id, startUtc: slot.startUtc });
    setSaving(false);
    if (res.ok) onDone();
    else setError(res.error);
  }

  const canPrev = day > today;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-t-2xl border border-border bg-card p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-frame sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">{t("rescheduleTitle")}</h2>
            <p className="mt-0.5 truncate text-sm text-faint-foreground">
              {appt.clientName} · {appt.service}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label={t("close")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Day stepper */}
        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setDay(shiftYmd(day, -1))}
            disabled={!canPrev || saving}
            aria-label={t("prevDay")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-secondary-foreground transition hover:bg-hover disabled:opacity-40"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-sm font-medium capitalize text-foreground">
            {formatBakuDate(day, locale)}
          </span>
          <button
            onClick={() => setDay(shiftYmd(day, 1))}
            disabled={saving}
            aria-label={t("nextDay")}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-secondary-foreground transition hover:bg-hover disabled:opacity-40"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
        </div>

        {/* Slots */}
        <div className="mt-4 min-h-[7rem]">
          {loading ? (
            <p className="py-8 text-center text-sm text-faint-foreground">{t("loadingSlots")}</p>
          ) : slots.length === 0 ? (
            <p className="py-8 text-center text-sm text-faint-foreground">{t("noSlots")}</p>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((s) => (
                <button
                  key={s.startUtc}
                  onClick={() => pick(s)}
                  disabled={saving}
                  className="h-11 rounded-lg border border-border text-sm font-medium tabular-nums text-secondary-foreground transition hover:border-rose-500 hover:bg-rose-500/10 disabled:opacity-50"
                >
                  {s.time}
                </button>
              ))}
            </div>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-rose-700 dark:text-rose-400">{error}</p>}
      </div>
    </div>
  );
}

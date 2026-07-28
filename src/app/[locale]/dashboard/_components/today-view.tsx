"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { setAppointmentStatus } from "../actions";
import { PullToRefresh } from "@/components/pwa/pull-to-refresh";
import { ErrorToast } from "./toast";
import { TodayAppointmentRow } from "./today-appointment-row";
import { RescheduleSheet } from "./reschedule-sheet";

export type TodayApptStatus = "CONFIRMED" | "COMPLETED" | "NO_SHOW";

export interface TodayAppointment {
  id: string;
  time: string; // Baku "HH:MM"
  status: TodayApptStatus;
  overdue: boolean; // CONFIRMED and end time already passed
  service: string;
  employee: string;
  clientName: string;
  clientPhone: string; // E.164
  priceLabel: string; // "25 ₼"
}

// Transient optimistic overlay applied on top of the server list until the next
// server refresh reconciles it.
type Override = { status?: TodayApptStatus; hidden?: boolean; pending?: boolean };

export function TodayView({
  items,
  dateLabel,
}: {
  items: TodayAppointment[];
  dateLabel: string;
}) {
  const t = useTranslations("Today");
  const router = useRouter();
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  const [error, setError] = useState<string | null>(null);
  const [rescheduleFor, setRescheduleFor] = useState<TodayAppointment | null>(null);

  // Fresh server data (router.refresh / navigation) is canonical — drop overlays.
  useEffect(() => {
    setOverrides({});
  }, [items]);

  async function changeStatus(id: string, status: "COMPLETED" | "NO_SHOW" | "CANCELLED") {
    setError(null);
    const rollback = overrides[id];
    // Optimistic: cancel hides the row; complete/no-show flip the badge.
    setOverrides((o) => ({
      ...o,
      [id]: {
        status: status === "CANCELLED" ? o[id]?.status : status,
        hidden: status === "CANCELLED",
        pending: true,
      },
    }));
    const res = await setAppointmentStatus({ id, status });
    if (res.ok) {
      // Pull canonical data; the useEffect above clears the overlay on arrival.
      router.refresh();
    } else {
      setOverrides((o) => ({ ...o, [id]: rollback ?? {} }));
      setError(res.error);
    }
  }

  const visible = items
    .map((appt) => ({ appt, ov: overrides[appt.id] }))
    .filter(({ ov }) => !ov?.hidden);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-4">
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-0.5 text-sm capitalize text-faint-foreground">
          {dateLabel} · {t("count", { count: visible.length })}
        </p>
      </div>

      <PullToRefresh onRefresh={() => router.refresh()}>
        {visible.length === 0 ? (
          <div className="flex min-h-[40vh] flex-col items-center justify-center text-center">
            <svg
              className="h-10 w-10 text-faint-foreground"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="4" width="18" height="18" rx="2" />
              <path d="M16 2v4M8 2v4M3 10h18" />
            </svg>
            <p className="mt-3 text-sm text-faint-foreground">{t("empty")}</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {visible.map(({ appt, ov }) => (
              <TodayAppointmentRow
                key={appt.id}
                appt={{ ...appt, status: ov?.status ?? appt.status }}
                pending={ov?.pending ?? false}
                onComplete={() => changeStatus(appt.id, "COMPLETED")}
                onNoShow={() => changeStatus(appt.id, "NO_SHOW")}
                onCancel={() => changeStatus(appt.id, "CANCELLED")}
                onReschedule={() => setRescheduleFor(appt)}
              />
            ))}
          </ul>
        )}
      </PullToRefresh>

      {rescheduleFor && (
        <RescheduleSheet
          appt={rescheduleFor}
          onClose={() => setRescheduleFor(null)}
          onDone={() => {
            setRescheduleFor(null);
            router.refresh();
          }}
        />
      )}

      {error && <ErrorToast message={error} onClose={() => setError(null)} />}
    </div>
  );
}

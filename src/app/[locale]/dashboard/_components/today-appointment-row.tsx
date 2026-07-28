"use client";

import { useTranslations } from "next-intl";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import type { TodayAppointment } from "./today-view";

// Minimum 44x44px touch targets (thumb-friendly). Colour by intent.
const BTN =
  "inline-flex h-11 min-w-[44px] items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition disabled:opacity-50";
const BTN_NEUTRAL = BTN + " border border-border text-secondary-foreground hover:bg-hover";
const BTN_COMPLETE =
  BTN + " bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 dark:text-emerald-300";
const BTN_DANGER = BTN + " text-rose-700 hover:bg-rose-500/10 dark:text-rose-400";
const BTN_WA = BTN + " bg-[#25D366]/15 text-[#128C4B] hover:bg-[#25D366]/25 dark:text-[#4ade80]";

const ICON = "h-4 w-4";

export function TodayAppointmentRow({
  appt,
  pending,
  salonName,
  dateLabel,
  onComplete,
  onNoShow,
  onCancel,
  onReschedule,
}: {
  appt: TodayAppointment;
  pending: boolean;
  salonName: string;
  dateLabel: string;
  onComplete: () => void;
  onNoShow: () => void;
  onCancel: () => void;
  onReschedule: () => void;
}) {
  const t = useTranslations("Today");

  const isConfirmed = appt.status === "CONFIRMED";
  const upcoming = isConfirmed && !appt.overdue;
  const needsClosing = isConfirmed && appt.overdue;

  // Contextual WhatsApp message: a reminder while the booking is still upcoming,
  // a thank-you/review request once it's completed (or a no-show follow-up).
  const waHref = buildWhatsAppLink(
    appt.clientPhone,
    upcoming ? "reminder" : "reviewRequest",
    {
      salon: salonName,
      service: appt.service,
      client: appt.clientName,
      when: `${dateLabel}, ${appt.time}`,
    },
  );

  const statusBadge = appt.overdue
    ? { label: t("overdue"), cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" }
    : appt.status === "COMPLETED"
      ? { label: t("statusCompleted"), cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }
      : appt.status === "NO_SHOW"
        ? { label: t("statusNoShow"), cls: "bg-rose-500/15 text-rose-700 dark:text-rose-300" }
        : { label: t("statusConfirmed"), cls: "bg-secondary text-secondary-foreground" };

  return (
    <li className={"rounded-xl border border-border bg-card p-3 " + (pending ? "opacity-60" : "")}>
      <div className="flex items-start gap-3">
        <div className="w-14 shrink-0 text-center">
          <div className="text-base font-semibold tabular-nums text-foreground">{appt.time}</div>
          <div className="mt-0.5 text-xs text-faint-foreground">{appt.priceLabel}</div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 truncate text-sm font-semibold text-foreground">
              {appt.clientName}
            </p>
            <span
              className={"shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium " + statusBadge.cls}
            >
              {statusBadge.label}
            </span>
          </div>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {appt.service} · {appt.employee}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {needsClosing && (
          <>
            <button onClick={onComplete} disabled={pending} className={BTN_COMPLETE}>
              <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {t("complete")}
            </button>
            <button onClick={onNoShow} disabled={pending} className={BTN_DANGER}>
              {t("noShow")}
            </button>
          </>
        )}

        {upcoming && (
          <>
            <button onClick={onReschedule} disabled={pending} className={BTN_NEUTRAL}>
              <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18M8 15h4" />
              </svg>
              {t("reschedule")}
            </button>
            <button onClick={onCancel} disabled={pending} className={BTN_DANGER}>
              {t("cancel")}
            </button>
          </>
        )}

        {needsClosing && (
          <button onClick={onCancel} disabled={pending} className={BTN_DANGER}>
            {t("cancel")}
          </button>
        )}

        {/* Message the client (WhatsApp) with a prefilled, contextual message. */}
        <a
          href={waHref}
          target="_blank"
          rel="noreferrer"
          className={BTN_WA + " ml-auto"}
        >
          <svg className={ICON} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.2c-.24.68-1.42 1.32-1.95 1.36-.5.05-.97.23-3.27-.68-2.76-1.09-4.5-3.9-4.64-4.08-.14-.18-1.1-1.46-1.1-2.79 0-1.32.7-1.97.94-2.24.24-.27.53-.34.71-.34.18 0 .36 0 .51.01.16.01.39-.06.6.46.24.57.82 1.97.89 2.11.07.14.12.31.02.5-.09.18-.14.29-.27.45-.14.16-.29.36-.41.48-.14.14-.28.29-.12.57.16.27.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.27.14.43.12.59-.07.16-.18.68-.79.86-1.07.18-.27.36-.23.6-.14.24.09 1.55.73 1.82.86.27.14.45.2.51.32.07.11.07.66-.17 1.34Z" />
          </svg>
          {t("message")}
        </a>
      </div>
    </li>
  );
}

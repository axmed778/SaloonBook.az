"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { minutesToHHMM } from "@/lib/time";
import { setAppointmentStatus, rescheduleSlots, rescheduleAppointment } from "../actions";
import { buildWhatsAppLink } from "@/lib/whatsapp-link";
import type { Slot } from "@/lib/availability";
import {
  blockBadge,
  azn,
  type CalendarBlock,
} from "./calendar-shared";

// Detail popup for a single appointment. A CONFIRMED booking can be completed,
// marked no-show, or cancelled; once it's in a terminal state we just show it.

export function AppointmentPopup({
  block,
  salonName,
  onClose,
}: {
  block: CalendarBlock;
  salonName: string;
  onClose: () => void;
}) {
  const t = useTranslations("Calendar");
  const tc = useTranslations("Common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reschedule ("move") mode: pick a new day, load that day's free slots for
  // this appointment's own employee+service, then move it in place — no
  // cancellation is sent to the customer (unlike cancel-and-rebook).
  const [mode, setMode] = useState<"view" | "reschedule">("view");
  const [rDay, setRDay] = useState("");
  const [rSlots, setRSlots] = useState<Slot[] | null>(null);
  const [rLoading, setRLoading] = useState(false);
  const todayYmd = new Date().toISOString().slice(0, 10);
  // Guards against a slow slots request for an earlier day resolving after a
  // later one and overwriting it (the user changed the date meanwhile).
  const rReqRef = useRef(0);

  function loadRSlots(day: string) {
    setRDay(day);
    setRSlots(null);
    setError(null);
    if (!day) return;
    const req = ++rReqRef.current;
    setRLoading(true);
    rescheduleSlots({ id: block.id, day })
      .then((res) => {
        if (req !== rReqRef.current) return; // a newer request superseded this one
        if (res.ok) setRSlots(res.slots);
        else setError(res.error);
      })
      .catch(() => {
        if (req === rReqRef.current) setError(t("popup.reschedule.loadError"));
      })
      .finally(() => {
        if (req === rReqRef.current) setRLoading(false);
      });
  }

  function exitReschedule() {
    setMode("view");
    setRDay("");
    setRSlots(null);
    setError(null);
  }

  function doReschedule(slot: Slot) {
    setError(null);
    startTransition(async () => {
      const res = await rescheduleAppointment({ id: block.id, startUtc: slot.startUtc });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  // Customer self-service page for this appointment (view / cancel /
  // reschedule). Until WhatsApp templates are approved, this is how the salon
  // gets the link to the customer: copy it, or open their own WhatsApp with a
  // prefilled message.
  const manageUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/a/${block.manageToken}`
      : `/a/${block.manageToken}`;
  const waHref =
    `https://wa.me/${block.customerPhone.replace(/[^\d]/g, "")}?text=` +
    encodeURIComponent(t("popup.waMessage", { name: block.subtitle, url: manageUrl }));

  // A contextual quick message (distinct from the manage-link share above): a
  // reminder while the booking is still upcoming, otherwise a thank-you/review
  // request. Opens the staff member's own WhatsApp with a prefilled AZ message.
  const upcoming = block.status === "CONFIRMED" && !block.overdue;
  const waQuickHref = buildWhatsAppLink(
    block.customerPhone,
    upcoming ? "reminder" : "reviewRequest",
    {
      salon: salonName,
      service: block.title,
      client: block.subtitle,
      when: `${block.dateLabel}, ${minutesToHHMM(block.startMin)}`,
    },
  );
  const waQuickLabel = upcoming ? t("popup.waReminder") : t("popup.waReview");

  function copyManageUrl() {
    navigator.clipboard?.writeText(manageUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  function apply(status: "COMPLETED" | "NO_SHOW" | "CANCELLED") {
    setError(null);
    startTransition(async () => {
      const res = await setAppointmentStatus({ id: block.id, status });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-foreground">{block.title}</h2>
            <span
              className={
                "mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium " +
                blockBadge(block)
              }
            >
              {block.overdue ? t("overdue") : t(`status.${block.status}`)}
            </span>
            {block.overdue && (
              <p className="mt-1.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                {t("overdueHint")}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={tc("close")} title={tc("close")}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-hover hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <Row label={t("popup.customer")} value={block.subtitle} />
          <Row label={t("popup.phone")} value={block.customerPhone} mono />
          <Row label={t("popup.employee")} value={block.employeeName} />
          <Row label={t("popup.date")} value={block.dateLabel} />
          <Row
            label={t("popup.time")}
            value={`${minutesToHHMM(block.startMin)} – ${minutesToHHMM(block.endMin)}`}
          />
          <Row label={t("popup.price")} value={`${azn(block.priceMinor)} ₼`} />
          <Row label={t("popup.source")} value={t(`source.${block.source}`)} />
        </dl>

        {block.notes && (
          <div className="mt-3 rounded-lg border border-border bg-muted/50 p-3">
            <p className="text-xs font-medium text-faint-foreground">{t("popup.notes")}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">
              {block.notes}
            </p>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-rose-700 dark:text-rose-400">{error}</p>}

        {/* Contextual WhatsApp quick message (reminder / thank-you+review). */}
        {mode === "view" && (
          <a
            href={waQuickHref}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-[#25D366]/40 bg-[#25D366]/10 px-3 py-2 text-sm font-medium text-[#128C4B] transition hover:bg-[#25D366]/20 dark:text-[#4ade80]"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm5.8 14.2c-.24.68-1.42 1.32-1.95 1.36-.5.05-.97.23-3.27-.68-2.76-1.09-4.5-3.9-4.64-4.08-.14-.18-1.1-1.46-1.1-2.79 0-1.32.7-1.97.94-2.24.24-.27.53-.34.71-.34.18 0 .36 0 .51.01.16.01.39-.06.6.46.24.57.82 1.97.89 2.11.07.14.12.31.02.5-.09.18-.14.29-.27.45-.14.16-.29.36-.41.48-.14.14-.28.29-.12.57.16.27.72 1.19 1.55 1.93 1.06.95 1.96 1.24 2.24 1.38.27.14.43.12.59-.07.16-.18.68-.79.86-1.07.18-.27.36-.23.6-.14.24.09 1.55.73 1.82.86.27.14.45.2.51.32.07.11.07.66-.17 1.34Z" />
            </svg>
            {waQuickLabel}
          </a>
        )}

        {block.status === "COMPLETED" && block.autoCompleted && (
          <div className="mt-4 rounded-xl border border-violet-500/40 bg-violet-500/10 p-3">
            <p className="text-xs font-medium text-violet-800 dark:text-violet-200">
              {t("popup.autoCompleted")}
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => apply("NO_SHOW")}
              className="mt-2 w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
            >
              {t("popup.markNoShow")}
            </button>
          </div>
        )}

        {block.status === "CONFIRMED" && mode === "view" && (
          <div className="mt-4 rounded-xl border border-border bg-muted p-3">
            <p className="text-xs font-medium text-muted-foreground">
              {t("popup.manageLinkLabel")}
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={copyManageUrl}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover"
              >
                {copied ? t("popup.copied") : t("popup.copyLink")}
              </button>
              <a
                href={waHref}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-center text-sm font-medium text-emerald-800 dark:text-emerald-200 transition hover:bg-emerald-500/20"
              >
                {t("popup.sendViaWhatsapp")}
              </a>
            </div>
          </div>
        )}

        {block.status === "CONFIRMED" && mode === "view" && (
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => apply("COMPLETED")}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-800 dark:text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
              >
                {t("popup.complete")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => apply("NO_SHOW")}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-800 dark:text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
              >
                {t("popup.markNoShow")}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => setMode("reschedule")}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-secondary-foreground transition hover:bg-hover disabled:opacity-50"
              >
                {t("popup.reschedule.button")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => apply("CANCELLED")}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
              >
                {tc("cancel")}
              </button>
            </div>
          </div>
        )}

        {block.status === "CONFIRMED" && mode === "reschedule" && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">
                {t("popup.reschedule.title")}
              </p>
              <button
                type="button"
                onClick={exitReschedule}
                className="text-xs font-medium text-accent hover:underline"
              >
                {t("popup.reschedule.back")}
              </button>
            </div>
            <input
              type="date"
              min={todayYmd}
              value={rDay}
              onChange={(e) => loadRSlots(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-rose-500 focus:outline-none"
            />
            {rLoading && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-busy="true">
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    key={i}
                    className="h-[36px] animate-pulse rounded-lg border border-border bg-muted"
                  />
                ))}
              </div>
            )}
            {!rLoading && rDay && rSlots && rSlots.length === 0 && (
              <p className="py-2 text-center text-sm text-muted-foreground">
                {t("popup.reschedule.noSlots")}
              </p>
            )}
            {!rLoading && rSlots && rSlots.length > 0 && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {rSlots.map((s) => (
                  <button
                    key={s.startUtc}
                    type="button"
                    disabled={pending}
                    onClick={() => doReschedule(s)}
                    className="rounded-lg border border-border bg-muted py-2 text-center text-sm text-muted-foreground transition hover:border-accent hover:text-foreground disabled:opacity-50"
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-faint-foreground">{label}</dt>
      <dd className={"text-right font-medium text-foreground " + (mono ? "font-mono" : "")}>
        {value}
      </dd>
    </div>
  );
}

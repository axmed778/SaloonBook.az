"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { minutesToHHMM } from "@/lib/time";
import { setAppointmentStatus, rescheduleSlots, rescheduleAppointment } from "../actions";
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
  onClose,
}: {
  block: CalendarBlock;
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

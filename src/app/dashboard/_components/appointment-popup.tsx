"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { minutesToHHMM } from "@/lib/time";
import { setAppointmentStatus } from "../actions";
import {
  STATUS_LABEL,
  STATUS_BADGE,
  sourceLabel,
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
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
        className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0d0d0f] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">{block.title}</h2>
            <span
              className={
                "mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium " +
                STATUS_BADGE[block.status]
              }
            >
              {STATUS_LABEL[block.status]}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Bağla"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
          </button>
        </div>

        <dl className="mt-4 space-y-3 text-sm">
          <Row label="Müştəri" value={block.subtitle} />
          <Row label="Telefon" value={block.customerPhone} mono />
          <Row label="Mütəxəssis" value={block.employeeName} />
          <Row label="Tarix" value={block.dateLabel} />
          <Row
            label="Vaxt"
            value={`${minutesToHHMM(block.startMin)} – ${minutesToHHMM(block.endMin)}`}
          />
          <Row label="Qiymət" value={`${azn(block.priceMinor)} ₼`} />
          <Row label="Mənbə" value={sourceLabel(block.source)} />
        </dl>

        {error && <p className="mt-4 text-sm text-rose-400">{error}</p>}

        {block.status === "CONFIRMED" && (
          <div className="mt-5 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => apply("COMPLETED")}
                className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-200 transition hover:bg-emerald-500/20 disabled:opacity-50"
              >
                Tamamla
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => apply("NO_SHOW")}
                className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-200 transition hover:bg-amber-500/20 disabled:opacity-50"
              >
                Gəlmədi
              </button>
            </div>
            <button
              type="button"
              disabled={pending}
              onClick={() => apply("CANCELLED")}
              className="w-full rounded-lg border border-zinc-800 px-3 py-2 text-sm font-medium text-zinc-400 transition hover:border-rose-500/40 hover:text-rose-300 disabled:opacity-50"
            >
              Ləğv et
            </button>
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
      <dt className="text-zinc-500">{label}</dt>
      <dd className={"text-right font-medium text-zinc-100 " + (mono ? "font-mono" : "")}>
        {value}
      </dd>
    </div>
  );
}

"use client";

import { useState } from "react";
import Link from "next/link";
import { minutesToHHMM } from "@/lib/time";
import {
  DAY_START_MIN,
  DAY_END_MIN,
  type CalendarColumn,
  type CalendarBlock,
} from "./calendar-shared";

// Day-view timetable: one column per employee, time down the side. Columns flex
// to fill the width when there are few employees, and scroll horizontally when
// there are many. Clicking an appointment opens a detail popup.

const ROW_H = 64; // px per hour
const PX_PER_MIN = ROW_H / 60;

const STATUS_STYLES: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "border-rose-500/50 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25",
  COMPLETED: "border-emerald-500/50 bg-emerald-500/10 text-emerald-50 hover:bg-emerald-500/20",
  NO_SHOW: "border-amber-500/50 bg-amber-500/10 text-amber-100/80 hover:bg-amber-500/20",
};

const STATUS_LABEL: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "Təsdiqlənib",
  COMPLETED: "Tamamlanıb",
  NO_SHOW: "Gəlmədi",
};

const STATUS_BADGE: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "bg-rose-500/15 text-rose-300",
  COMPLETED: "bg-emerald-500/15 text-emerald-300",
  NO_SHOW: "bg-amber-500/15 text-amber-300",
};

const sourceLabel = (s: string) =>
  s === "PUBLIC" ? "Onlayn qeydiyyat" : "Əl ilə (panel)";

const azn = (minor: number) => {
  const v = minor / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

export function Calendar({
  prevDay,
  nextDay,
  dateLabel,
  isToday,
  columns,
  blocks,
}: {
  day: string;
  prevDay: string;
  nextDay: string;
  dateLabel: string;
  isToday: boolean;
  columns: CalendarColumn[];
  blocks: CalendarBlock[];
}) {
  const [selected, setSelected] = useState<CalendarBlock | null>(null);

  const hours: number[] = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hours.push(m);
  const bodyHeight = ((DAY_END_MIN - DAY_START_MIN) / 60) * ROW_H;

  const selectedEmployee = selected
    ? columns.find((c) => c.id === selected.columnId)?.name ?? "—"
    : "";

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Təqvim</h1>
          <p className="mt-0.5 text-sm capitalize text-zinc-500">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard?day=${prevDay}`}
            aria-label="Əvvəlki gün"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </Link>
          <Link
            href="/dashboard"
            className={
              "rounded-lg border px-3 py-1.5 text-sm font-medium transition " +
              (isToday
                ? "border-zinc-800 text-zinc-500"
                : "border-zinc-800 text-zinc-200 hover:bg-zinc-800/60")
            }
          >
            Bu gün
          </Link>
          <Link
            href={`/dashboard?day=${nextDay}`}
            aria-label="Növbəti gün"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-800 text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </Link>
        </div>
      </div>

      {columns.length === 0 ? (
        <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-zinc-800 bg-[#0d0d0f] text-center">
          <p className="text-sm font-medium text-zinc-300">Hələ işçi əlavə etməmisiniz</p>
          <p className="mt-1 max-w-xs text-sm text-zinc-500">
            Təqvimdə görüşlərin görünməsi üçün əvvəlcə İşçilər bölməsindən işçi əlavə edin.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-[#0d0d0f]">
          <div className="flex min-w-full">
            {/* Time gutter */}
            <div className="w-14 shrink-0 border-r border-zinc-800">
              <div className="h-12 border-b border-zinc-800" />
              <div className="relative" style={{ height: bodyHeight }}>
                {hours.map((m, i) => (
                  <div
                    key={m}
                    className="absolute right-2 -translate-y-1/2 text-xs text-zinc-500"
                    style={{ top: i * ROW_H }}
                  >
                    {i === 0 ? "" : minutesToHHMM(m)}
                  </div>
                ))}
              </div>
            </div>

            {/* Employee columns — flex to fill, min width so many columns scroll */}
            {columns.map((col) => {
              const colBlocks = blocks.filter((b) => b.columnId === col.id);
              return (
                <div
                  key={col.id}
                  className="min-w-[180px] flex-1 border-r border-zinc-800 last:border-r-0"
                >
                  <div className="flex h-12 flex-col items-center justify-center border-b border-zinc-800 px-2">
                    <span className="text-sm font-medium text-zinc-100">{col.name}</span>
                    {col.position && (
                      <span className="text-[11px] text-zinc-500">{col.position}</span>
                    )}
                  </div>
                  <div className="relative" style={{ height: bodyHeight }}>
                    {hours.map((m, i) => (
                      <div
                        key={m}
                        className="absolute inset-x-0 border-b border-zinc-800/50"
                        style={{ top: i * ROW_H, height: 0 }}
                      />
                    ))}
                    {colBlocks.map((b) => {
                      const top = (b.startMin - DAY_START_MIN) * PX_PER_MIN;
                      const height = Math.max((b.endMin - b.startMin) * PX_PER_MIN - 2, 20);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setSelected(b)}
                          className={
                            "absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 text-left transition-colors " +
                            STATUS_STYLES[b.status]
                          }
                          style={{ top, height }}
                        >
                          <p className="truncate text-xs font-semibold">
                            {minutesToHHMM(b.startMin)} · {b.title}
                          </p>
                          <p className="truncate text-[11px] opacity-80">{b.subtitle}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Appointment detail popup */}
      {selected && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-sm rounded-2xl border border-zinc-800 bg-[#0d0d0f] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-zinc-100">{selected.title}</h2>
                <span
                  className={
                    "mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium " +
                    STATUS_BADGE[selected.status]
                  }
                >
                  {STATUS_LABEL[selected.status]}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Bağla"
                className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition hover:bg-zinc-800/60 hover:text-zinc-100"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
              </button>
            </div>

            <dl className="mt-4 space-y-3 text-sm">
              <Row label="Müştəri" value={selected.subtitle} />
              <Row label="Telefon" value={selected.customerPhone} mono />
              <Row label="Mütəxəssis" value={selectedEmployee} />
              <Row label="Tarix" value={dateLabel} />
              <Row
                label="Vaxt"
                value={`${minutesToHHMM(selected.startMin)} – ${minutesToHHMM(selected.endMin)}`}
              />
              <Row label="Qiymət" value={`${azn(selected.priceMinor)} ₼`} />
              <Row label="Mənbə" value={sourceLabel(selected.source)} />
            </dl>
          </div>
        </div>
      )}
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

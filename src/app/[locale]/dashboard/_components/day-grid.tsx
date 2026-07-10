"use client";

import { useTranslations } from "next-intl";
import { minutesToHHMM } from "@/lib/time";
import {
  DAY_START_MIN,
  DAY_END_MIN,
  STATUS_STYLES,
  type CalendarColumn,
  type CalendarBlock,
} from "./calendar-shared";

// Day-view timetable: one column per employee, time down the side. Columns flex
// to fill the width when there are few employees, and scroll horizontally when
// there are many. Clicking an appointment opens the detail popup.

const ROW_H = 64; // px per hour
const PX_PER_MIN = ROW_H / 60;

export function DayGrid({
  columns,
  blocks,
  onSelect,
}: {
  columns: CalendarColumn[];
  blocks: CalendarBlock[];
  onSelect: (b: CalendarBlock) => void;
}) {
  const t = useTranslations("Calendar");
  const hours: number[] = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hours.push(m);
  const bodyHeight = ((DAY_END_MIN - DAY_START_MIN) / 60) * ROW_H;

  if (columns.length === 0) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center rounded-xl border border-zinc-800 bg-[#0d0d0f] text-center">
        <p className="text-sm font-medium text-zinc-300">{t("emptyTitle")}</p>
        <p className="mt-1 max-w-xs text-sm text-zinc-500">
          {t("emptyBody")}
        </p>
      </div>
    );
  }

  return (
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
                      onClick={() => onSelect(b)}
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
  );
}

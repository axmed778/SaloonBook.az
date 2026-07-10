"use client";

import { Link } from "@/i18n/navigation";
import { minutesToHHMM } from "@/lib/time";
import {
  DAY_START_MIN,
  DAY_END_MIN,
  STATUS_STYLES,
  packLanes,
  type CalendarBlock,
  type WeekDay,
} from "./calendar-shared";

// Week-view timetable: one column per day (Mon–Sun), all employees merged.
// Overlapping appointments within a day are split into side-by-side lanes.
// A day header links to that day's day view; clicking a block opens the popup.

const ROW_H = 56; // px per hour (a touch tighter than the day view)
const PX_PER_MIN = ROW_H / 60;

export function WeekGrid({
  weekDays,
  blocks,
  onSelect,
}: {
  weekDays: WeekDay[];
  blocks: CalendarBlock[];
  onSelect: (b: CalendarBlock) => void;
}) {
  const hours: number[] = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hours.push(m);
  const bodyHeight = ((DAY_END_MIN - DAY_START_MIN) / 60) * ROW_H;

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

        {/* Day columns */}
        {weekDays.map((wd) => {
          const packed = packLanes(blocks.filter((b) => b.columnId === wd.ymd));
          return (
            <div
              key={wd.ymd}
              className="min-w-[120px] flex-1 border-r border-zinc-800 last:border-r-0"
            >
              <Link
                href={`/dashboard?view=day&day=${wd.ymd}`}
                className={
                  "flex h-12 flex-col items-center justify-center border-b border-zinc-800 px-2 transition hover:bg-zinc-800/40 " +
                  (wd.isToday ? "bg-rose-500/10" : "")
                }
              >
                <span
                  className={
                    "text-[11px] uppercase " +
                    (wd.isToday ? "text-rose-300" : "text-zinc-500")
                  }
                >
                  {wd.weekdayLabel}
                </span>
                <span
                  className={
                    "text-sm font-medium " +
                    (wd.isToday ? "text-rose-200" : "text-zinc-100")
                  }
                >
                  {wd.dayLabel}
                </span>
              </Link>
              <div className="relative" style={{ height: bodyHeight }}>
                {hours.map((m, i) => (
                  <div
                    key={m}
                    className="absolute inset-x-0 border-b border-zinc-800/50"
                    style={{ top: i * ROW_H, height: 0 }}
                  />
                ))}
                {packed.map(({ item: b, lane, lanes }) => {
                  const top = (b.startMin - DAY_START_MIN) * PX_PER_MIN;
                  const height = Math.max((b.endMin - b.startMin) * PX_PER_MIN - 2, 18);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => onSelect(b)}
                      className={
                        "absolute overflow-hidden rounded-md border px-1.5 py-1 text-left transition-colors " +
                        STATUS_STYLES[b.status]
                      }
                      style={{
                        top,
                        height,
                        left: `calc(${(lane / lanes) * 100}% + 1px)`,
                        width: `calc(${100 / lanes}% - 2px)`,
                      }}
                    >
                      <p className="truncate text-[11px] font-semibold leading-tight">
                        {minutesToHHMM(b.startMin)} {b.title}
                      </p>
                      <p className="truncate text-[10px] leading-tight opacity-80">
                        {b.employeeName}
                      </p>
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

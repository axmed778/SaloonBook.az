import Link from "next/link";
import { minutesToHHMM } from "@/lib/time";

// Day-view timetable: one column per employee, time down the side. Purely
// presentational — the page loads appointments and maps them to the shape below.

export const DAY_START_MIN = 8 * 60; // 08:00
export const DAY_END_MIN = 22 * 60; // 22:00
const ROW_H = 64; // px per hour
const PX_PER_MIN = ROW_H / 60;

export type CalendarColumn = { id: string; name: string; position: string | null };

export type CalendarBlock = {
  id: string;
  columnId: string;
  startMin: number; // minutes from Baku midnight
  endMin: number;
  title: string; // service
  subtitle: string; // customer
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW";
};

const STATUS_STYLES: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "border-rose-500/40 bg-rose-500/15 text-rose-50",
  COMPLETED: "border-emerald-500/40 bg-emerald-500/10 text-emerald-50",
  NO_SHOW: "border-amber-500/40 bg-amber-500/10 text-amber-100/80 line-through",
};

export function Calendar({
  day,
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
  const hours: number[] = [];
  for (let m = DAY_START_MIN; m < DAY_END_MIN; m += 60) hours.push(m);
  const bodyHeight = ((DAY_END_MIN - DAY_START_MIN) / 60) * ROW_H;

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
          <div className="flex min-w-max">
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

            {/* Employee columns */}
            {columns.map((col) => {
              const colBlocks = blocks.filter((b) => b.columnId === col.id);
              return (
                <div
                  key={col.id}
                  className="w-56 shrink-0 border-r border-zinc-800 last:border-r-0"
                >
                  <div className="flex h-12 flex-col items-center justify-center border-b border-zinc-800 px-2">
                    <span className="text-sm font-medium text-zinc-100">{col.name}</span>
                    {col.position && (
                      <span className="text-[11px] text-zinc-500">{col.position}</span>
                    )}
                  </div>
                  <div className="relative" style={{ height: bodyHeight }}>
                    {/* Hour gridlines */}
                    {hours.map((m, i) => (
                      <div
                        key={m}
                        className="absolute inset-x-0 border-b border-zinc-800/50"
                        style={{ top: i * ROW_H, height: 0 }}
                      />
                    ))}
                    {/* Appointment blocks */}
                    {colBlocks.map((b) => {
                      const top = (b.startMin - DAY_START_MIN) * PX_PER_MIN;
                      const height = Math.max((b.endMin - b.startMin) * PX_PER_MIN - 2, 20);
                      return (
                        <div
                          key={b.id}
                          className={
                            "absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 " +
                            STATUS_STYLES[b.status]
                          }
                          style={{ top, height }}
                        >
                          <p className="truncate text-xs font-semibold">
                            {minutesToHHMM(b.startMin)} · {b.title}
                          </p>
                          <p className="truncate text-[11px] opacity-80">{b.subtitle}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

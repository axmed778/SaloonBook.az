"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { shiftYmd, bakuWeekday } from "@/lib/time";
import {
  type CalendarColumn,
  type CalendarBlock,
  type CatalogEmployee,
  type WeekDay,
} from "./calendar-shared";
import { DayGrid } from "./day-grid";
import { WeekGrid } from "./week-grid";
import { AppointmentPopup } from "./appointment-popup";
import { BookingModal } from "./booking-modal";

// Calendar shell: toolbar (view toggle, period nav, "new booking"), the day or
// week grid, and the two overlays (appointment detail, manual-booking form).

// Baku Monday that starts the week containing `ymd` (weekday: 0=Sun..6=Sat).
function weekStartOf(ymd: string): string {
  return shiftYmd(ymd, -((bakuWeekday(ymd) + 6) % 7));
}

export function Calendar({
  view,
  day,
  today,
  periodLabel,
  columns,
  weekDays,
  blocks,
  catalog,
  windowStartMin,
  windowEndMin,
}: {
  view: "day" | "week";
  day: string;
  today: string;
  periodLabel: string;
  columns: CalendarColumn[];
  weekDays: WeekDay[];
  blocks: CalendarBlock[];
  catalog: CatalogEmployee[];
  windowStartMin: number;
  windowEndMin: number;
}) {
  const t = useTranslations("Calendar");
  const [selected, setSelected] = useState<CalendarBlock | null>(null);
  const [booking, setBooking] = useState(false);

  const isWeek = view === "week";
  const prev = isWeek ? shiftYmd(weekStartOf(day), -7) : shiftYmd(day, -1);
  const next = isWeek ? shiftYmd(weekStartOf(day), 7) : shiftYmd(day, 1);
  const atNow = isWeek ? weekStartOf(day) === weekStartOf(today) : day === today;
  const href = (target: string, v: "day" | "week" = view) =>
    `/dashboard?view=${v}&day=${target}`;

  const canBook = catalog.some((e) => e.services.length > 0);

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
          <p className="mt-0.5 text-sm capitalize text-faint-foreground">{periodLabel}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-lg border border-border p-0.5">
            <Link
              href={href(day, "day")}
              className={
                "rounded-md px-3 py-1 text-sm font-medium transition " +
                (!isWeek ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")
              }
            >
              {t("viewDay")}
            </Link>
            <Link
              href={href(day, "week")}
              className={
                "rounded-md px-3 py-1 text-sm font-medium transition " +
                (isWeek ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground")
              }
            >
              {t("viewWeek")}
            </Link>
          </div>

          {/* Period nav */}
          <div className="flex items-center gap-2">
            <Link
              href={href(prev)}
              aria-label={isWeek ? t("prevWeek") : t("prevDay")}
              title={isWeek ? t("prevWeek") : t("prevDay")}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover hover:text-foreground"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            </Link>
            <Link
              href={href(today)}
              className={
                "rounded-lg border px-3 py-1.5 text-sm font-medium transition " +
                (atNow
                  ? "border-border text-faint-foreground"
                  : "border-border text-secondary-foreground hover:bg-hover")
              }
            >
              {isWeek ? t("thisWeek") : t("thisDay")}
            </Link>
            <Link
              href={href(next)}
              aria-label={isWeek ? t("nextWeek") : t("nextDay")}
              title={isWeek ? t("nextWeek") : t("nextDay")}
              className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:bg-hover hover:text-foreground"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
            </Link>
          </div>

          {/* New booking */}
          <button
            type="button"
            onClick={() => setBooking(true)}
            disabled={!canBook}
            title={canBook ? undefined : t("needStaffFirst")}
            className="flex items-center gap-1.5 rounded-lg bg-rose-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
            {t("newBooking")}
          </button>
        </div>
      </div>

      {isWeek ? (
        <WeekGrid
          weekDays={weekDays}
          blocks={blocks}
          onSelect={setSelected}
          windowStartMin={windowStartMin}
          windowEndMin={windowEndMin}
        />
      ) : (
        <DayGrid
          columns={columns}
          blocks={blocks}
          onSelect={setSelected}
          windowStartMin={windowStartMin}
          windowEndMin={windowEndMin}
        />
      )}

      {selected && (
        <AppointmentPopup block={selected} onClose={() => setSelected(null)} />
      )}

      {booking && (
        <BookingModal
          catalog={catalog}
          defaultDay={day >= today ? day : today}
          today={today}
          onClose={() => setBooking(false)}
        />
      )}
    </div>
  );
}

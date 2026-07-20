// Azerbaijan is UTC+4 year-round (no DST since 2016). We store instants in UTC
// and render them in Asia/Baku. These helpers convert between a Baku wall-clock
// (calendar day + minutes-from-midnight) and a UTC instant.

export const BAKU_TZ = "Asia/Baku";
export const BAKU_OFFSET_MINUTES = 240; // UTC+4

/** "YYYY-MM-DD" (a Baku local date) + minutes-from-midnight -> UTC instant. */
export function bakuWallClockToUtc(dayYmd: string, minutesFromMidnight: number): Date {
  const [y, m, d] = dayYmd.split("-").map(Number);
  const utcMs =
    Date.UTC(y, m - 1, d) + minutesFromMidnight * 60_000 - BAKU_OFFSET_MINUTES * 60_000;
  return new Date(utcMs);
}

/** UTC instant -> "YYYY-MM-DD" in Baku local time. */
export function bakuYmd(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: BAKU_TZ }).format(date);
}

/** "YYYY-MM-DD" of the current Baku day. */
export function bakuToday(): string {
  return bakuYmd(new Date());
}

/** Billing/usage period key, e.g. "2026-06", for a given instant (Baku month). */
export function bakuPeriodYm(date: Date): string {
  return bakuYmd(date).slice(0, 7);
}

/** Minutes from local Baku midnight for a UTC instant (0..1439, can exceed on
 *  the rare day if called with a far-future instant — callers pass same-day). */
export function bakuMinutesOfDay(date: Date): number {
  const ymd = bakuYmd(date);
  const midnightUtc = bakuWallClockToUtc(ymd, 0).getTime();
  return Math.round((date.getTime() - midnightUtc) / 60_000);
}

/**
 * Minutes from a SPECIFIC Baku day's midnight to `date`. Unlike
 * bakuMinutesOfDay (which measures against the instant's own Baku day), this
 * measures against `dayYmd`, so an end instant that runs to or past midnight
 * returns a value >= 1440 instead of wrapping back to a small number. Lets the
 * calendar keep an appointment's real height on its start day.
 */
export function bakuMinutesOfDayOn(date: Date, dayYmd: string): number {
  const midnightUtc = bakuWallClockToUtc(dayYmd, 0).getTime();
  return Math.round((date.getTime() - midnightUtc) / 60_000);
}

/** Weekday for a Baku calendar date: 0=Sunday .. 6=Saturday. */
export function bakuWeekday(dayYmd: string): number {
  const [y, m, d] = dayYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** UTC bounds [start, end) of a Baku calendar day. */
export function bakuDayBoundsUtc(dayYmd: string): { startUtc: Date; endUtc: Date } {
  return {
    startUtc: bakuWallClockToUtc(dayYmd, 0),
    endUtc: bakuWallClockToUtc(dayYmd, 24 * 60),
  };
}

/** Shift a Baku calendar date "YYYY-MM-DD" by whole days. */
export function shiftYmd(dayYmd: string, deltaDays: number): string {
  const [y, m, d] = dayYmd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + deltaDays)).toISOString().slice(0, 10);
}

/**
 * Human date label for a Baku calendar date, e.g. "1 iyul 2026, çərşənbə axşamı".
 * `locale` is a BCP-47 tag for display (defaults to Azerbaijani); the Baku time
 * zone is fixed regardless of locale. Server/worker callers can omit it.
 */
export function formatBakuDate(dayYmd: string, locale = "az-AZ"): string {
  const [y, m, d] = dayYmd.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, {
    timeZone: BAKU_TZ,
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/**
 * Add whole months to an instant, clamping to the last day of the target month.
 * Plain `Date.setMonth` overflows — Jan 31 + 1 month becomes Mar 3, silently
 * gifting/stealing days on trial and billing-period math. This lands on Feb
 * 28/29 instead. Operates on local calendar fields to match the previous
 * `setMonth` call sites (server runs UTC, where local == UTC).
 */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setDate(1); // avoid overflow while we move the month
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

/** Add whole days to an instant. Simple UTC-ms arithmetic — no DST in Baku. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatBakuDateTime(date: Date, locale = "az-AZ"): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: BAKU_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

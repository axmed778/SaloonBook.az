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

export function minutesToHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatBakuDateTime(date: Date): string {
  return new Intl.DateTimeFormat("az-AZ", {
    timeZone: BAKU_TZ,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

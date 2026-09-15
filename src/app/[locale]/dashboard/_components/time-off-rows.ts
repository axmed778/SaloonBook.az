import { bakuYmd, formatBakuDate, shiftYmd } from "@/lib/time";
import type { TimeOffRow } from "./time-off-modal";

/**
 * Time-off entries as the time-off modal lists them: one label per whole-day
 * range. Shared by the Staff and Time off screens so both read the same dates.
 */
export function timeOffRows(
  entries: { id: string; startsAt: Date; endsAt: Date; reason: string | null }[],
  df: Parameters<typeof formatBakuDate>[1],
): TimeOffRow[] {
  return entries.map((entry) => {
    // endsAt is exclusive (start of the day after the last day off).
    const fromYmd = bakuYmd(entry.startsAt);
    const toYmd = shiftYmd(bakuYmd(entry.endsAt), -1);
    return {
      id: entry.id,
      label:
        fromYmd === toYmd
          ? formatBakuDate(fromYmd, df)
          : `${formatBakuDate(fromYmd, df)} – ${formatBakuDate(toYmd, df)}`,
      reason: entry.reason,
    };
  });
}

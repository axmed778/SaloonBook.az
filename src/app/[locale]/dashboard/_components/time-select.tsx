"use client";

import { minToHHMM } from "@/lib/business-hours";

// 24-hour "HH:MM" options in 15-minute steps. Azerbaijan uses 24h; the native
// <input type="time"> picker forced a dated 12h AM/PM dropdown.
export const TIME_OPTIONS: string[] = Array.from({ length: (24 * 60) / 15 }, (_, i) =>
  minToHHMM(i * 15),
);

const cls =
  "rounded-lg border border-border bg-background px-2.5 py-2 text-sm tabular-nums text-foreground focus:border-rose-500 focus:outline-none";

/**
 * Styled 24h time dropdown. Keeps an off-grid saved value (not on the 15-minute
 * grid) selectable by folding it into the option list rather than showing blank.
 */
export function TimeSelect({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const options = TIME_OPTIONS.includes(value) ? TIME_OPTIONS : [value, ...TIME_OPTIONS];
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cls + (className ? " " + className : "")}
    >
      {options.map((tm) => (
        <option key={tm} value={tm}>
          {tm}
        </option>
      ))}
    </select>
  );
}

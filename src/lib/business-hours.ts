// Salon-level weekly opening hours. Stored as JSON on Salon.businessHours.
// weekday: 0=Sunday..6=Saturday (same convention as WorkingHour). Minutes are
// Baku-local minutes from midnight. Only open days are stored; a missing weekday
// means "closed". Displayed Monday-first, as is conventional in Azerbaijan.

export type BusinessHour = { weekday: number; openMin: number; closeMin: number };

export const WEEKDAYS_ORDER = [1, 2, 3, 4, 5, 6, 0];

export const WEEKDAY_LABEL: Record<number, string> = {
  1: "Bazar ertəsi",
  2: "Çərşənbə axşamı",
  3: "Çərşənbə",
  4: "Cümə axşamı",
  5: "Cümə",
  6: "Şənbə",
  0: "Bazar",
};

export const minToHHMM = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const hhmmToMin = (s: string) => {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
};

/** Narrow an unknown JSON value (from Prisma) into a BusinessHour[]. */
export function parseBusinessHours(value: unknown): BusinessHour[] {
  if (!Array.isArray(value)) return [];
  const out: BusinessHour[] = [];
  for (const v of value) {
    if (
      v &&
      typeof v === "object" &&
      typeof (v as Record<string, unknown>).weekday === "number" &&
      typeof (v as Record<string, unknown>).openMin === "number" &&
      typeof (v as Record<string, unknown>).closeMin === "number"
    ) {
      const h = v as BusinessHour;
      out.push({ weekday: h.weekday, openMin: h.openMin, closeMin: h.closeMin });
    }
  }
  return out;
}

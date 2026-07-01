// Shared, framework-neutral types/constants for the calendar. Kept out of the
// "use client" component file so the server page can import the constants and
// types without pulling in a client module.

export const DAY_START_MIN = 8 * 60; // 08:00
export const DAY_END_MIN = 22 * 60; // 22:00

export type CalendarColumn = { id: string; name: string; position: string | null };

export type CalendarBlock = {
  id: string;
  columnId: string;
  startMin: number; // minutes from Baku midnight
  endMin: number; // includes service buffer
  title: string; // service name
  subtitle: string; // customer name
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW";
  priceMinor: number;
  customerPhone: string;
  source: string; // "PUBLIC" | "DASHBOARD"
};

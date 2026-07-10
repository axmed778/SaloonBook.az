// Shared, framework-neutral types/constants for the calendar. Kept out of the
// "use client" component files so the server page can import the constants and
// types without pulling in a client module.

export const DAY_START_MIN = 8 * 60; // 08:00
export const DAY_END_MIN = 22 * 60; // 22:00

// Shared input/label styling, matching the other dashboard managers.
export const inputCls =
  "rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none";
export const labelCls = "mb-1 block text-xs font-medium text-zinc-400";

export type CalendarColumn = { id: string; name: string; position: string | null };

export type CalendarBlock = {
  id: string;
  // Day view: employeeId. Week view: the appointment's Baku day, "YYYY-MM-DD".
  columnId: string;
  startMin: number; // minutes from Baku midnight (clamped to the visible window)
  endMin: number; // includes service buffer
  title: string; // service name
  subtitle: string; // customer name
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW";
  priceMinor: number;
  customerPhone: string;
  source: string; // "PUBLIC" | "DASHBOARD"
  manageToken: string; // customer self-service link: /a/{manageToken}
  employeeName: string; // shown in the detail popup (and week-view blocks)
  dateLabel: string; // this appointment's Baku date label (for the popup)
};

// Catalog backing the manual-booking form: active employees and, per employee,
// the active services they can perform.
export type CatalogService = {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
};
export type CatalogEmployee = {
  id: string;
  name: string;
  services: CatalogService[];
};

// Per-status presentation, shared by the grids and the detail popup.
export const STATUS_STYLES: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "border-rose-500/50 bg-rose-500/15 text-rose-50 hover:bg-rose-500/25",
  COMPLETED: "border-emerald-500/50 bg-emerald-500/10 text-emerald-50 hover:bg-emerald-500/20",
  NO_SHOW: "border-amber-500/50 bg-amber-500/10 text-amber-100/80 hover:bg-amber-500/20",
};

// Status/source display text lives in the "Calendar" message namespace
// (status.*, source.*); components translate it at render.

export const STATUS_BADGE: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "bg-rose-500/15 text-rose-300",
  COMPLETED: "bg-emerald-500/15 text-emerald-300",
  NO_SHOW: "bg-amber-500/15 text-amber-300",
};

/** Minor units (qəpik) -> AZN string, dropping a trailing ".00". */
export const azn = (minor: number) => {
  const v = minor / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

// One column of the week view.
export type WeekDay = {
  ymd: string; // "YYYY-MM-DD"
  weekdayLabel: string; // e.g. "B.e"
  dayLabel: string; // e.g. "6 iyul"
  isToday: boolean;
};

/**
 * Greedy interval packing for the week grid: overlapping appointments within one
 * day are split into side-by-side lanes. Each returned item carries its lane
 * index and the number of lanes in its overlap cluster, so the caller can size
 * width = 1/lanes and offset left = lane/lanes.
 */
export function packLanes<T extends { startMin: number; endMin: number }>(
  items: T[],
): Array<{ item: T; lane: number; lanes: number }> {
  const sorted = [...items].sort(
    (a, b) => a.startMin - b.startMin || a.endMin - b.endMin,
  );
  const out: Array<{ item: T; lane: number; lanes: number }> = [];
  let cluster: Array<{ item: T; lane: number }> = [];
  let clusterEnd = -Infinity;
  const laneEnds: number[] = []; // end time of the last item placed in each lane

  const flush = () => {
    const lanes = laneEnds.length;
    for (const c of cluster) out.push({ item: c.item, lane: c.lane, lanes });
    cluster = [];
    laneEnds.length = 0;
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    // A gap from every item so far starts a fresh cluster (lanes reset).
    if (cluster.length && item.startMin >= clusterEnd) flush();

    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return out;
}

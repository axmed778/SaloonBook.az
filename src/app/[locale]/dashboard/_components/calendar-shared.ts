// Shared, framework-neutral types/constants for the calendar. Kept out of the
// "use client" component files so the server page can import the constants and
// types without pulling in a client module.

import type { Prisma } from "@prisma/client";
import { bakuMinutesOfDayOn, bakuYmd } from "@/lib/time";
import type { SerializedBooking } from "@/lib/serializers/booking";

// DEFAULT visible window. The grids expand it from the data so bookings outside
// these hours (a barber working till 23:00) still render — these are just the
// minimum window shown when everything falls inside.
export const DAY_START_MIN = 8 * 60; // 08:00
export const DAY_END_MIN = 22 * 60; // 22:00

// Shared input/label styling, matching the other dashboard managers.
export const inputCls =
  "rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint-foreground focus:border-rose-500 focus:outline-none";
export const labelCls = "mb-1 block text-xs font-medium text-muted-foreground";

export type CalendarColumn = {
  id: string;
  name: string;
  position: string | null;
  // Day view only: the employee is deactivated but still has appointments on
  // this day, so the column is shown (greyed) to keep those bookings visible.
  inactive?: boolean;
};

export type CalendarBlock = {
  id: string;
  // Day view: employeeId. Week view: the appointment's Baku day, "YYYY-MM-DD".
  columnId: string;
  startMin: number; // real minutes from the start day's Baku midnight (unclamped)
  endMin: number; // includes service buffer; capped at 1440 if it runs to midnight
  title: string; // service name
  addons: string[]; // add-ons booked on top of the service (may be empty)
  subtitle: string; // customer name
  status: "CONFIRMED" | "COMPLETED" | "NO_SHOW";
  // True when the 48h reconcile sweep auto-closed this (→ COMPLETED) rather than
  // staff confirming it. Shown as "unconfirmed" and still correctable to NO_SHOW.
  autoCompleted: boolean;
  // A CONFIRMED booking whose time has already passed but hasn't been closed
  // (completed / no-show). Rendered distinctly so staff clear it at day's end.
  overdue: boolean;
  priceMinor: number;
  // Contact details. OWNER/ADMIN only: for a master's login these keys are
  // ABSENT — the server never selects the columns and never serializes the
  // keys, so the number is not in the RSC payload either (see
  // lib/serializers/booking.ts). The popup renders a phone row and the
  // WhatsApp buttons only when the value is actually here.
  customerPhone?: string;
  // The customer's wish for the service ("tünd çalar"). Shown to every role;
  // for a master it arrives already redacted by the server serializer, so what
  // is in this field IS what may be displayed.
  serviceNote: string | null;
  source: string; // "PUBLIC" | "DASHBOARD"
  manageToken: string; // customer self-service link: /a/{manageToken}
  employeeName: string; // shown in the detail popup (and week-view blocks)
  dateLabel: string; // this appointment's Baku date label (for the popup)
};

const MINUTES_IN_DAY = 24 * 60;

/**
 * Serialized booking -> calendar block. The ONLY place a block is built, for
 * both the day view (columnId = employeeId) and the week view (columnId = the
 * booking's Baku day), so the contact fields are carried across exactly once
 * and a master's block simply has no `customerPhone` key to leak.
 */
export function toCalendarBlock(
  b: SerializedBooking,
  columnId: string,
  dateLabel: string,
): CalendarBlock {
  // Keep the REAL, unclamped minutes so labels/popup show the true times; the
  // grid derives its visible window from the data. Both ends are measured
  // against the START day's midnight so a booking that runs to/past midnight
  // keeps its real height (bakuMinutesOfDay would wrap the end back to ~0).
  const startYmd = bakuYmd(b.startsAt);
  return {
    id: b.id,
    columnId,
    startMin: bakuMinutesOfDayOn(b.startsAt, startYmd),
    endMin: Math.min(bakuMinutesOfDayOn(b.endsAt, startYmd), MINUTES_IN_DAY),
    title: b.serviceName,
    addons: b.addonNames,
    subtitle: b.customerName,
    status: b.status as CalendarBlock["status"],
    autoCompleted: b.autoCompleted,
    // Past-due but still CONFIRMED -> needs closing (completed / no-show).
    overdue: b.status === "CONFIRMED" && b.endsAt.getTime() < Date.now(),
    priceMinor: b.priceMinor,
    source: b.source,
    manageToken: b.manageToken,
    employeeName: b.employeeName,
    dateLabel,
    serviceNote: b.serviceNote,
    // Conditional spread, not `customerPhone: b.customerPhone`: assigning
    // undefined would still create the key, and JSON/flight serialization of a
    // present-but-undefined key is exactly the kind of detail that turns a
    // redaction into a leak.
    ...(b.customerPhone !== undefined ? { customerPhone: b.customerPhone } : {}),
  };
}

// Catalog backing the manual-booking form: active employees and, per employee,
// the active services they can perform, each with its active add-ons.
export type CatalogAddon = {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
};
export type CatalogService = {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
  addons: CatalogAddon[];
};
export type CatalogEmployee = {
  id: string;
  name: string;
  services: CatalogService[];
};

/** The Prisma select for one catalog service; pair with toCatalogService(). */
export const CATALOG_SERVICE_SELECT = {
  id: true,
  name: true,
  priceMinor: true,
  durationMin: true,
  addons: {
    where: { addon: { isActive: true } },
    orderBy: { addon: { createdAt: "asc" } },
    select: { addon: { select: { id: true, name: true, priceMinor: true, durationMin: true } } },
  },
} satisfies Prisma.ServiceSelect;

/** A service row read with CATALOG_SERVICE_SELECT -> the catalog shape. */
export function toCatalogService(s: {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
  addons: { addon: CatalogAddon }[];
}): CatalogService {
  return { ...s, addons: s.addons.map((l) => l.addon) };
}

// Per-status presentation, shared by the grids and the detail popup.
export const STATUS_STYLES: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "border-rose-500/50 bg-rose-500/15 text-rose-800 dark:text-rose-50 hover:bg-rose-500/25",
  COMPLETED: "border-emerald-500/50 bg-emerald-500/10 text-emerald-800 dark:text-emerald-50 hover:bg-emerald-500/20",
  NO_SHOW: "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-100/80 hover:bg-amber-500/20",
};

// Status/source display text lives in the "Calendar" message namespace
// (status.*, source.*); components translate it at render.

export const STATUS_BADGE: Record<CalendarBlock["status"], string> = {
  CONFIRMED: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  COMPLETED: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  NO_SHOW: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

// Overdue = past-due CONFIRMED, awaiting close. A distinct violet (not reused by
// any status) plus an inset pulsing ring so it stands out even in a busy day —
// the cue for staff to mark it completed or no-show. `ring-inset` survives the
// block's overflow-hidden clip.
export const OVERDUE_STYLE =
  "border-violet-500/60 bg-violet-500/20 text-violet-900 dark:text-violet-50 ring-2 ring-inset ring-violet-500/70 animate-pulse hover:bg-violet-500/30";

export const OVERDUE_BADGE = "bg-violet-500/15 text-violet-700 dark:text-violet-300";

/** Block background style, accounting for the derived overdue state. */
export function blockStyle(b: CalendarBlock): string {
  return b.overdue ? OVERDUE_STYLE : STATUS_STYLES[b.status];
}

/** Status-badge style, accounting for the derived overdue state. */
export function blockBadge(b: CalendarBlock): string {
  return b.overdue ? OVERDUE_BADGE : STATUS_BADGE[b.status];
}

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

// Ordering rules for the admin account table, kept out of the component so
// they can be tested without rendering one. Sorting happens in the browser on
// purpose: the page loads every account (there is no pagination here), so the
// client already holds the whole set — re-ordering it is instant and complete,
// and a server round trip would buy nothing and cost a query per click.

export type SortKey =
  | "salon"
  | "created"
  | "owner"
  | "plan"
  | "status"
  | "ends"
  | "paid"
  | "bookings";

export type SortDir = "asc" | "desc";

/** The fields ordering reads. A row may carry anything else besides. */
export type SortableRow = {
  salonName: string;
  ownerEmail: string;
  plan: string;
  status: string | null;
  createdAtMs: number;
  /** The instant behind the "ends" column; null when there is no date. */
  endsAtMs: number | null;
  totalPaidMinor: number;
  bookingsThisMonth: number;
};

// Plans compare by rank, not by name: "BASIC < PRO" is what sorting by plan
// means to an admin, and the alphabet answers "BASIC, FREE, PRO, START".
export const PLAN_RANK: Record<string, number> = { FREE: 0, START: 1, BASIC: 2, PRO: 3 };

// Statuses compare by how much attention they need. The reason to sort a
// support queue by status is to gather the problems at one end, and no
// alphabet does that — least of all across three locales.
export const STATUS_RANK: Record<string, number> = {
  PAST_DUE: 0,
  FREE_DOWNGRADED: 1,
  CANCELLED: 2,
  TRIALING: 3,
  ACTIVE: 4,
};

/** Which way a column sorts the first time it is clicked. */
export const FIRST_DIR: Record<SortKey, SortDir> = {
  salon: "asc",
  created: "desc", // newest signups first
  owner: "asc",
  plan: "desc", // paying plans first
  status: "asc", // problems first
  ends: "asc", // expiring soonest first — the rows you act on today
  paid: "desc", // biggest payers first
  bookings: "desc",
};

/**
 * Rows with nothing to compare sink to the bottom in BOTH directions. An
 * account with no subscription has no end date; flipping the arrow must not
 * float a blank cell to the top of a list being scanned for dates.
 */
export function nullsLast(a: number | null, b: number | null, sign: number): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return sign * (a - b);
}

export function compareRows(
  a: SortableRow,
  b: SortableRow,
  key: SortKey,
  dir: SortDir,
  collator: Intl.Collator,
): number {
  const sign = dir === "asc" ? 1 : -1;
  switch (key) {
    case "salon":
      return sign * collator.compare(a.salonName, b.salonName);
    case "owner":
      return sign * collator.compare(a.ownerEmail, b.ownerEmail);
    case "plan":
      return sign * ((PLAN_RANK[a.plan] ?? -1) - (PLAN_RANK[b.plan] ?? -1));
    case "status": {
      // An unknown status ranks after the known ones but before "no
      // subscription at all", which has nothing to rank.
      const rank = (r: SortableRow) => (r.status ? (STATUS_RANK[r.status] ?? 90) : null);
      return nullsLast(rank(a), rank(b), sign);
    }
    case "created":
      return sign * (a.createdAtMs - b.createdAtMs);
    case "ends":
      return nullsLast(a.endsAtMs, b.endsAtMs, sign);
    case "paid":
      return sign * (a.totalPaidMinor - b.totalPaidMinor);
    case "bookings":
      return sign * (a.bookingsThisMonth - b.bookingsThisMonth);
  }
}

/**
 * Order a copy of `rows`. Ties break by newest-first so equal cells keep a
 * fixed order instead of jittering between renders.
 */
export function sortRows<T extends SortableRow>(
  rows: readonly T[],
  key: SortKey,
  dir: SortDir,
  locale: string,
): T[] {
  // Locale-aware: Azerbaijani orders ə/ö/ş away from where a byte compare puts
  // them, and `numeric` keeps "Salon 2" before "Salon 10".
  const collator = new Intl.Collator(locale, { sensitivity: "base", numeric: true });
  return [...rows].sort(
    (a, b) => compareRows(a, b, key, dir, collator) || b.createdAtMs - a.createdAtMs,
  );
}

/** Clicking the active column flips it; a new column starts at its own default. */
export function nextSort(
  current: { key: SortKey; dir: SortDir },
  key: SortKey,
): { key: SortKey; dir: SortDir } {
  if (current.key !== key) return { key, dir: FIRST_DIR[key] };
  return { key, dir: current.dir === "asc" ? "desc" : "asc" };
}

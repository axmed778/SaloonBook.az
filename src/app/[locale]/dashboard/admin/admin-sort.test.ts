import { describe, it, expect } from "vitest";
import { nextSort, sortRows, type SortableRow, type SortKey } from "./admin-sort";

// The table's ordering rules. Worth pinning because two of them are deliberate
// departures from "sort the text": plans and statuses order by meaning, and
// rows with no value stay at the bottom whichever way the arrow points.

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1);

function row(partial: Partial<SortableRow> & { salonName: string }): SortableRow {
  return {
    ownerEmail: `${partial.salonName.toLowerCase()}@example.com`,
    plan: "BASIC",
    status: "ACTIVE",
    createdAtMs: T0,
    endsAtMs: T0 + 30 * DAY,
    totalPaidMinor: 0,
    bookingsThisMonth: 0,
    ...partial,
  };
}

const names = (rows: SortableRow[]) => rows.map((r) => r.salonName);

describe("sortRows", () => {
  it("orders by creation date both ways", () => {
    const rows = [
      row({ salonName: "middle", createdAtMs: T0 + DAY }),
      row({ salonName: "oldest", createdAtMs: T0 }),
      row({ salonName: "newest", createdAtMs: T0 + 2 * DAY }),
    ];
    expect(names(sortRows(rows, "created", "desc", "ru"))).toEqual([
      "newest",
      "middle",
      "oldest",
    ]);
    expect(names(sortRows(rows, "created", "asc", "ru"))).toEqual([
      "oldest",
      "middle",
      "newest",
    ]);
  });

  it("orders by subscription end, soonest first", () => {
    const rows = [
      row({ salonName: "later", endsAtMs: T0 + 60 * DAY }),
      row({ salonName: "sooner", endsAtMs: T0 + 2 * DAY }),
    ];
    expect(names(sortRows(rows, "ends", "asc", "ru"))).toEqual(["sooner", "later"]);
    expect(names(sortRows(rows, "ends", "desc", "ru"))).toEqual(["later", "sooner"]);
  });

  it("keeps rows without an end date at the bottom in BOTH directions", () => {
    const rows = [
      row({ salonName: "no-date", endsAtMs: null }),
      row({ salonName: "later", endsAtMs: T0 + 60 * DAY }),
      row({ salonName: "sooner", endsAtMs: T0 + 2 * DAY }),
    ];
    expect(names(sortRows(rows, "ends", "asc", "ru")).at(-1)).toBe("no-date");
    expect(names(sortRows(rows, "ends", "desc", "ru")).at(-1)).toBe("no-date");
  });

  it("orders by money paid, not by payment count", () => {
    const rows = [
      row({ salonName: "small", totalPaidMinor: 1500 }),
      row({ salonName: "big", totalPaidMinor: 120_000 }),
      row({ salonName: "none", totalPaidMinor: 0 }),
    ];
    expect(names(sortRows(rows, "paid", "desc", "ru"))).toEqual(["big", "small", "none"]);
  });

  it("orders plans by rank, which the alphabet gets wrong", () => {
    const rows = [
      row({ salonName: "b", plan: "BASIC" }),
      row({ salonName: "f", plan: "FREE" }),
      row({ salonName: "p", plan: "PRO" }),
      row({ salonName: "s", plan: "START" }),
    ];
    expect(names(sortRows(rows, "plan", "desc", "ru"))).toEqual(["p", "b", "s", "f"]);
    // Sorting the plan NAMES would have produced this instead:
    expect(["BASIC", "FREE", "PRO", "START"]).not.toEqual(["FREE", "START", "BASIC", "PRO"]);
  });

  it("orders statuses by how much attention they need", () => {
    const rows = [
      row({ salonName: "ok", status: "ACTIVE" }),
      row({ salonName: "trial", status: "TRIALING" }),
      row({ salonName: "overdue", status: "PAST_DUE" }),
      row({ salonName: "none", status: null }),
    ];
    expect(names(sortRows(rows, "status", "asc", "ru"))).toEqual([
      "overdue",
      "trial",
      "ok",
      "none", // no subscription — nothing to rank, so it stays last
    ]);
    expect(names(sortRows(rows, "status", "desc", "ru")).at(-1)).toBe("none");
  });

  it("orders names case-insensitively and numerically", () => {
    const rows = [
      row({ salonName: "Salon 10" }),
      row({ salonName: "salon 2" }),
      row({ salonName: "Alfa" }),
    ];
    expect(names(sortRows(rows, "salon", "asc", "ru"))).toEqual([
      "Alfa",
      "salon 2",
      "Salon 10",
    ]);
  });

  it("breaks ties by newest first, so equal cells never jitter", () => {
    const rows = [
      row({ salonName: "older", bookingsThisMonth: 5, createdAtMs: T0 }),
      row({ salonName: "newer", bookingsThisMonth: 5, createdAtMs: T0 + DAY }),
    ];
    for (const dir of ["asc", "desc"] as const) {
      expect(names(sortRows(rows, "bookings", dir, "ru"))).toEqual(["newer", "older"]);
    }
  });

  it("does not mutate the array it was given", () => {
    const rows = [
      row({ salonName: "b", createdAtMs: T0 }),
      row({ salonName: "a", createdAtMs: T0 + DAY }),
    ];
    const before = names(rows);
    sortRows(rows, "salon", "asc", "ru");
    expect(names(rows)).toEqual(before);
  });
});

describe("nextSort", () => {
  it("flips the direction when the active column is clicked again", () => {
    expect(nextSort({ key: "created", dir: "desc" }, "created")).toEqual({
      key: "created",
      dir: "asc",
    });
    expect(nextSort({ key: "created", dir: "asc" }, "created")).toEqual({
      key: "created",
      dir: "desc",
    });
  });

  it("starts a new column at the end worth looking at", () => {
    const from = { key: "created" as SortKey, dir: "desc" as const };
    expect(nextSort(from, "ends")).toEqual({ key: "ends", dir: "asc" }); // expiring soonest
    expect(nextSort(from, "paid")).toEqual({ key: "paid", dir: "desc" }); // biggest payers
    expect(nextSort(from, "salon")).toEqual({ key: "salon", dir: "asc" }); // A→Z
  });
});

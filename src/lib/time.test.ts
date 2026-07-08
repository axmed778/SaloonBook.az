import { describe, it, expect } from "vitest";
import {
  bakuWallClockToUtc,
  bakuYmd,
  bakuPeriodYm,
  bakuMinutesOfDay,
  bakuWeekday,
  bakuDayBoundsUtc,
  shiftYmd,
  addMonths,
} from "./time";

// Baku is UTC+4 year-round (no DST) — every helper leans on that invariant.
// A subtle off-by-one here silently shifts appointments, month windows, and
// trial expiries, so the round-trips are pinned.

describe("bakuWallClockToUtc", () => {
  it("Baku midnight is 20:00 UTC the previous day", () => {
    expect(bakuWallClockToUtc("2026-07-07", 0).toISOString()).toBe("2026-07-06T20:00:00.000Z");
  });

  it("10:30 Baku is 06:30 UTC", () => {
    expect(bakuWallClockToUtc("2026-07-07", 10 * 60 + 30).toISOString()).toBe(
      "2026-07-07T06:30:00.000Z",
    );
  });
});

describe("bakuYmd", () => {
  it("round-trips wall clock → UTC → wall clock across the day boundary", () => {
    // 23:59 Baku still belongs to the same Baku day…
    expect(bakuYmd(bakuWallClockToUtc("2026-07-07", 23 * 60 + 59))).toBe("2026-07-07");
    // …and 20:00 UTC (00:00 Baku next day) already belongs to the next one.
    expect(bakuYmd(new Date("2026-07-07T20:00:00Z"))).toBe("2026-07-08");
  });
});

describe("bakuDayBoundsUtc", () => {
  it("spans exactly 24 hours, end-exclusive at the next Baku midnight", () => {
    const { startUtc, endUtc } = bakuDayBoundsUtc("2026-07-07");
    expect(endUtc.getTime() - startUtc.getTime()).toBe(24 * 60 * 60_000);
    expect(bakuYmd(new Date(endUtc.getTime() - 1))).toBe("2026-07-07");
    expect(bakuYmd(endUtc)).toBe("2026-07-08");
  });
});

describe("bakuMinutesOfDay", () => {
  it("inverts bakuWallClockToUtc", () => {
    for (const min of [0, 1, 600, 1439]) {
      expect(bakuMinutesOfDay(bakuWallClockToUtc("2026-02-28", min))).toBe(min);
    }
  });
});

describe("bakuWeekday", () => {
  it("matches the calendar (2026-07-07 is a Tuesday, 2026-07-12 a Sunday)", () => {
    expect(bakuWeekday("2026-07-07")).toBe(2);
    expect(bakuWeekday("2026-07-12")).toBe(0);
  });
});

describe("shiftYmd", () => {
  it("crosses month and year boundaries, including leap Februaries", () => {
    expect(shiftYmd("2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftYmd("2026-03-01", -1)).toBe("2026-02-28"); // 2026 is not a leap year
    expect(shiftYmd("2028-03-01", -1)).toBe("2028-02-29"); // 2028 is
  });
});

describe("bakuPeriodYm", () => {
  it("uses the Baku month, not the UTC month, at the boundary", () => {
    // 2026-07-31 21:00 UTC = 2026-08-01 01:00 Baku → August period.
    expect(bakuPeriodYm(new Date("2026-07-31T21:00:00Z"))).toBe("2026-08");
  });
});

describe("addMonths", () => {
  // Construct + assert with LOCAL fields so the test is timezone-independent
  // (addMonths operates on local calendar fields, matching its call sites).
  const ymd = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;

  it("clamps to the last day when the target month is shorter", () => {
    expect(ymd(addMonths(new Date(2026, 0, 31), 1))).toBe("2026-02-28"); // non-leap
    expect(ymd(addMonths(new Date(2028, 0, 31), 1))).toBe("2028-02-29"); // leap
    expect(ymd(addMonths(new Date(2026, 0, 31), 3))).toBe("2026-04-30"); // Jan 31 -> Apr 30
  });

  it("keeps the day when the target month is long enough", () => {
    expect(ymd(addMonths(new Date(2026, 0, 15), 1))).toBe("2026-02-15");
  });

  it("rolls the year over and still clamps", () => {
    expect(ymd(addMonths(new Date(2026, 10, 30), 3))).toBe("2027-02-28"); // Nov 30 -> Feb 28
  });

  it("preserves the time of day", () => {
    const d = addMonths(new Date(2026, 0, 31, 9, 45, 12), 1);
    expect([d.getHours(), d.getMinutes(), d.getSeconds()]).toEqual([9, 45, 12]);
  });
});

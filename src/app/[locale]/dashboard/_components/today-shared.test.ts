import { describe, it, expect } from "vitest";
import { dayTotalsByMethod } from "./today-shared";

// The Today header strip: what is in the drawer today, by method. Not revenue —
// it is keyed on the PAYMENT day and counts money that arrived, whatever day the
// booking was for. Phase 3 replaces this with the shift close.

const cash = (amountMinor: number, tipMinor = 0) =>
  ({ kind: "PAYMENT", method: "CASH", amountMinor, tipMinor }) as const;
const card = (amountMinor: number, tipMinor = 0) =>
  ({ kind: "PAYMENT", method: "CARD", amountMinor, tipMinor }) as const;

describe("dayTotalsByMethod", () => {
  it("is empty on a day with nothing taken", () => {
    expect(dayTotalsByMethod([])).toEqual({ byMethod: [], netMinor: 0, tipsMinor: 0 });
  });

  it("adds up each method separately", () => {
    const t = dayTotalsByMethod([cash(2000), cash(1000), card(4500)]);
    expect(t.byMethod).toEqual([
      { method: "CASH", netMinor: 3000 },
      { method: "CARD", netMinor: 4500 },
    ]);
    expect(t.netMinor).toBe(7500);
  });

  it("subtracts a refund from its own method", () => {
    const t = dayTotalsByMethod([
      cash(4500),
      { kind: "REFUND", method: "CASH", amountMinor: 1000, tipMinor: 0 },
    ]);
    expect(t.byMethod).toEqual([{ method: "CASH", netMinor: 3500 }]);
  });

  it("can go negative when a refund outweighs the day's takings", () => {
    const t = dayTotalsByMethod([{ kind: "REFUND", method: "CARD", amountMinor: 1000, tipMinor: 0 }]);
    expect(t.byMethod).toEqual([{ method: "CARD", netMinor: -1000 }]);
    expect(t.netMinor).toBe(-1000);
  });

  // The rule the owner asked for: tips on their own line, never inside a method.
  it("keeps tips out of the method figures and reports them separately", () => {
    const t = dayTotalsByMethod([cash(4500, 500), card(2000, 300)]);
    expect(t.byMethod).toEqual([
      { method: "CASH", netMinor: 4500 },
      { method: "CARD", netMinor: 2000 },
    ]);
    expect(t.netMinor).toBe(6500);
    expect(t.tipsMinor).toBe(800);
  });

  it("keeps a fixed method order regardless of the order money came in", () => {
    const t = dayTotalsByMethod([
      { kind: "PAYMENT", method: "TRANSFER", amountMinor: 100, tipMinor: 0 },
      { kind: "PAYMENT", method: "TERMINAL", amountMinor: 100, tipMinor: 0 },
      card(100),
      cash(100),
    ]);
    expect(t.byMethod.map((m) => m.method)).toEqual(["CASH", "CARD", "TERMINAL", "TRANSFER"]);
  });

  // A row of zeros is noise on a phone.
  it("omits a method that nets to zero", () => {
    const t = dayTotalsByMethod([
      cash(1000),
      { kind: "REFUND", method: "CASH", amountMinor: 1000, tipMinor: 0 },
      card(500),
    ]);
    expect(t.byMethod).toEqual([{ method: "CARD", netMinor: 500 }]);
  });
});

import { describe, it, expect } from "vitest";
import { bookingRevenueMinor, revenueMinor, isRevenueBearing } from "./revenue";
import type { PaymentEntry } from "./payments";

function pay(amountMinor: number, extra: Partial<PaymentEntry> = {}): PaymentEntry {
  return { kind: "PAYMENT", amountMinor, discountMinor: 0, tipMinor: 0, voidedAt: null, ...extra };
}
function refund(amountMinor: number, extra: Partial<PaymentEntry> = {}): PaymentEntry {
  return { ...pay(amountMinor, extra), kind: "REFUND" };
}

const VOIDED = { voidedAt: new Date("2026-09-15T10:00:00Z") };

describe("which bookings carry revenue", () => {
  it.each(["COMPLETED", "CANCELLED", "NO_SHOW"])("%s does", (status) => {
    expect(isRevenueBearing(status)).toBe(true);
  });

  // The work has not happened; money taken up front is a deposit until it does.
  it("CONFIRMED does not", () => {
    expect(isRevenueBearing("CONFIRMED")).toBe(false);
  });

  it("an unknown status does not", () => {
    expect(isRevenueBearing("PENCILLED_IN")).toBe(false);
  });
});

describe("bookingRevenueMinor", () => {
  it("is what was received on a completed booking", () => {
    expect(bookingRevenueMinor({ status: "COMPLETED", payments: [pay(4500)] })).toBe(4500);
  });

  it("is zero for a confirmed booking, however much was prepaid", () => {
    expect(bookingRevenueMinor({ status: "CONFIRMED", payments: [pay(4500)] })).toBe(0);
  });

  // "Completed bookings plus kept prepayments", with no separate rule for it.
  it("is zero for a cancelled booking nobody paid for", () => {
    expect(bookingRevenueMinor({ status: "CANCELLED", payments: [] })).toBe(0);
  });

  it("is the kept prepayment on a cancelled booking", () => {
    expect(bookingRevenueMinor({ status: "CANCELLED", payments: [pay(2000)] })).toBe(2000);
  });

  it("is the kept prepayment on a no-show", () => {
    expect(bookingRevenueMinor({ status: "NO_SHOW", payments: [pay(2000)] })).toBe(2000);
  });

  it("is zero when a cancelled booking's prepayment was handed back", () => {
    expect(
      bookingRevenueMinor({ status: "CANCELLED", payments: [pay(2000), refund(2000)] }),
    ).toBe(0);
  });

  it("nets refunds off a completed booking", () => {
    expect(bookingRevenueMinor({ status: "COMPLETED", payments: [pay(4500), refund(1000)] })).toBe(3500);
  });

  it("ignores voided entries", () => {
    expect(
      bookingRevenueMinor({ status: "COMPLETED", payments: [pay(4500), pay(9900, VOIDED)] }),
    ).toBe(4500);
  });

  // The three exclusions that make revenue different from "settled".
  it("does not count a discount", () => {
    expect(
      bookingRevenueMinor({ status: "COMPLETED", payments: [pay(3000, { discountMinor: 1500 })] }),
    ).toBe(3000);
  });

  it("is zero for a fully comped booking", () => {
    expect(
      bookingRevenueMinor({ status: "COMPLETED", payments: [pay(0, { discountMinor: 4500 })] }),
    ).toBe(0);
  });

  it("does not count a tip", () => {
    expect(
      bookingRevenueMinor({ status: "COMPLETED", payments: [pay(4500, { tipMinor: 500 })] }),
    ).toBe(4500);
  });
});

describe("revenueMinor", () => {
  it("is zero over no bookings", () => {
    expect(revenueMinor([])).toBe(0);
  });

  it("sums only the bookings that resolved", () => {
    expect(
      revenueMinor([
        { status: "COMPLETED", payments: [pay(4500)] },
        { status: "CONFIRMED", payments: [pay(3000)] }, // not yet earned
        { status: "NO_SHOW", payments: [pay(1000)] }, // kept prepayment
        { status: "CANCELLED", payments: [] }, // adds nothing
        { status: "COMPLETED", payments: [pay(2000, { discountMinor: 500, tipMinor: 300 })] },
      ]),
    ).toBe(4500 + 1000 + 2000);
  });

  it("can be dragged down by a refund on another booking", () => {
    expect(
      revenueMinor([
        { status: "COMPLETED", payments: [pay(4500)] },
        { status: "CANCELLED", payments: [pay(2000), refund(2000)] },
      ]),
    ).toBe(4500);
  });
});

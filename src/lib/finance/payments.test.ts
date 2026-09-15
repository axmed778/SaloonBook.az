import { describe, it, expect } from "vitest";
import {
  netReceivedMinor,
  settledMinor,
  tipsMinor,
  paymentStatusOf,
  summarize,
  refuseNewPayment,
  refuseRefund,
  refuseVoid,
  type PaymentEntry,
} from "./payments";

// Amounts are qəpik. 4500 is 45,00 ₼.

function pay(amountMinor: number, extra: Partial<PaymentEntry> = {}): PaymentEntry {
  return {
    kind: "PAYMENT",
    amountMinor,
    discountMinor: 0,
    tipMinor: 0,
    voidedAt: null,
    ...extra,
  };
}

function refund(amountMinor: number, extra: Partial<PaymentEntry> = {}): PaymentEntry {
  return { ...pay(amountMinor, extra), kind: "REFUND" };
}

const VOIDED = { voidedAt: new Date("2026-09-15T10:00:00Z") };

describe("what the entries add up to", () => {
  it("is zero for a booking with nothing on it", () => {
    expect(netReceivedMinor([])).toBe(0);
    expect(settledMinor([])).toBe(0);
    expect(tipsMinor([])).toBe(0);
  });

  it("adds up a split payment", () => {
    const entries = [pay(2000), pay(2500)];
    expect(netReceivedMinor(entries)).toBe(4500);
    expect(settledMinor(entries)).toBe(4500);
  });

  it("subtracts a refund from what was received", () => {
    const entries = [pay(4500), refund(1000)];
    expect(netReceivedMinor(entries)).toBe(3500);
    expect(settledMinor(entries)).toBe(3500);
  });

  it("ignores voided entries everywhere", () => {
    const entries = [pay(4500), pay(9900, VOIDED), refund(1000, VOIDED)];
    expect(netReceivedMinor(entries)).toBe(4500);
    expect(settledMinor(entries)).toBe(4500);
  });

  // The distinction the whole phase turns on.
  it("counts a discount as settled but never as received", () => {
    const entries = [pay(3000, { discountMinor: 1500 })];
    expect(settledMinor(entries)).toBe(4500);
    expect(netReceivedMinor(entries)).toBe(3000);
  });

  it("keeps tips out of both, and counts them on their own", () => {
    const entries = [pay(4500, { tipMinor: 500 })];
    expect(netReceivedMinor(entries)).toBe(4500);
    expect(settledMinor(entries)).toBe(4500);
    expect(tipsMinor(entries)).toBe(500);
  });

  it("does not count a voided entry's tip", () => {
    expect(tipsMinor([pay(4500, { tipMinor: 500, ...VOIDED })])).toBe(0);
  });
});

describe("paymentStatusOf", () => {
  const PRICE = 4500;

  it("is unpaid with nothing on the booking", () => {
    expect(paymentStatusOf([], PRICE)).toBe("unpaid");
  });

  it("is unpaid when every entry was voided", () => {
    expect(paymentStatusOf([pay(4500, VOIDED)], PRICE)).toBe("unpaid");
  });

  it("is partial when part of the price is settled", () => {
    expect(paymentStatusOf([pay(2000)], PRICE)).toBe("partial");
  });

  // The addition the owner made: short of the price is simply partial. There is
  // no debt concept in this phase.
  it("is partial when the money is short and no discount explains it", () => {
    expect(paymentStatusOf([pay(4000)], PRICE)).toBe("partial");
  });

  it("is paid on the exact price", () => {
    expect(paymentStatusOf([pay(4500)], PRICE)).toBe("paid");
  });

  it("is paid when a discount makes up the difference", () => {
    expect(paymentStatusOf([pay(3000, { discountMinor: 1500 })], PRICE)).toBe("paid");
  });

  // The case the owner asked for a test on: staff or goodwill, nothing received,
  // and the booking is square.
  it("is paid for a fully comped booking", () => {
    expect(paymentStatusOf([pay(0, { discountMinor: 4500 })], PRICE)).toBe("paid");
  });

  it("is paid when the price is zero and nothing was taken", () => {
    expect(paymentStatusOf([], 0)).toBe("paid");
  });

  it("falls back to partial when a refund undoes part of a settled booking", () => {
    expect(paymentStatusOf([pay(4500), refund(1000)], PRICE)).toBe("partial");
  });

  it("falls back to unpaid when a refund undoes all of it", () => {
    expect(paymentStatusOf([pay(4500), refund(4500)], PRICE)).toBe("unpaid");
  });

  it("does not let a tip settle the price", () => {
    expect(paymentStatusOf([pay(4000, { tipMinor: 500 })], PRICE)).toBe("partial");
  });
});

describe("summarize", () => {
  it("prefills the form with what is left to take", () => {
    expect(summarize([pay(2000)], 4500).remainingMinor).toBe(2500);
  });

  it("never asks for a negative remainder", () => {
    // Can't arise through refuseNewPayment, but the popup must not render "-5 ₼"
    // if a row ever gets in another way.
    expect(summarize([pay(9900)], 4500).remainingMinor).toBe(0);
  });

  it("reports a comped booking as paid with nothing received", () => {
    const s = summarize([pay(0, { discountMinor: 4500 })], 4500);
    expect(s).toMatchObject({
      status: "paid",
      netReceivedMinor: 0,
      settledMinor: 4500,
      remainingMinor: 0,
    });
  });
});

describe("refuseNewPayment", () => {
  const PRICE = 4500;

  it("allows a payment that fits", () => {
    expect(refuseNewPayment({ amountMinor: 4500, discountMinor: 0, tipMinor: 0 }, [], PRICE)).toBeNull();
  });

  it("allows the second half of a split", () => {
    expect(
      refuseNewPayment({ amountMinor: 2500, discountMinor: 0, tipMinor: 0 }, [pay(2000)], PRICE),
    ).toBeNull();
  });

  it("allows a fully comped booking", () => {
    expect(
      refuseNewPayment({ amountMinor: 0, discountMinor: 4500, tipMinor: 0 }, [], PRICE),
    ).toBeNull();
  });

  it.each([
    ["a negative amount", { amountMinor: -1, discountMinor: 0, tipMinor: 0 }, "amountNegative"],
    ["a negative discount", { amountMinor: 100, discountMinor: -1, tipMinor: 0 }, "discountNegative"],
    ["a negative tip", { amountMinor: 100, discountMinor: 0, tipMinor: -1 }, "tipNegative"],
    ["an entry that moves nothing", { amountMinor: 0, discountMinor: 0, tipMinor: 0 }, "emptyEntry"],
    ["a tip with no payment behind it", { amountMinor: 0, discountMinor: 0, tipMinor: 500 }, "emptyEntry"],
  ] as const)("refuses %s", (_label, entry, refusal) => {
    expect(refuseNewPayment(entry, [], PRICE)).toBe(refusal);
  });

  it("refuses more than the price", () => {
    expect(
      refuseNewPayment({ amountMinor: 5000, discountMinor: 0, tipMinor: 0 }, [], PRICE),
    ).toBe("exceedsPrice");
  });

  it("refuses a payment that would overshoot with the discount counted", () => {
    expect(
      refuseNewPayment({ amountMinor: 4500, discountMinor: 500, tipMinor: 0 }, [], PRICE),
    ).toBe("exceedsPrice");
  });

  it("refuses a second payment that would overshoot", () => {
    expect(
      refuseNewPayment({ amountMinor: 3000, discountMinor: 0, tipMinor: 0 }, [pay(2000)], PRICE),
    ).toBe("exceedsPrice");
  });

  // Change over the price is a tip, and the tip field is outside the overpay
  // sum — otherwise it would inflate revenue and every payout built on it.
  it("allows a tip on top of a fully paid booking", () => {
    expect(
      refuseNewPayment({ amountMinor: 4500, discountMinor: 0, tipMinor: 500 }, [], PRICE),
    ).toBeNull();
  });

  it("ignores voided entries when deciding whether there is room", () => {
    expect(
      refuseNewPayment({ amountMinor: 4500, discountMinor: 0, tipMinor: 0 }, [pay(4500, VOIDED)], PRICE),
    ).toBeNull();
  });

  it("leaves room again after a refund", () => {
    expect(
      refuseNewPayment({ amountMinor: 1000, discountMinor: 0, tipMinor: 0 }, [pay(4500), refund(1000)], PRICE),
    ).toBeNull();
  });
});

describe("refuseRefund", () => {
  it("allows a refund up to what was received", () => {
    expect(refuseRefund(4500, [pay(4500)])).toBeNull();
    expect(refuseRefund(1000, [pay(4500)])).toBeNull();
  });

  it("refuses more than was received", () => {
    expect(refuseRefund(5000, [pay(4500)])).toBe("refundExceedsPaid");
  });

  it("refuses a refund on a booking with nothing received", () => {
    expect(refuseRefund(1000, [])).toBe("refundOnEmpty");
  });

  // Nothing was handed over, so there is nothing to hand back.
  it("refuses a refund against a discount alone", () => {
    expect(refuseRefund(1000, [pay(0, { discountMinor: 4500 })])).toBe("refundOnEmpty");
  });

  // An empty form field is not a negative number: "enter an amount" is the
  // message, not "the amount is negative".
  it("asks for an amount when none was entered", () => {
    expect(refuseRefund(0, [pay(4500)])).toBe("amountRequired");
  });

  it("still refuses a negative refund as negative", () => {
    expect(refuseRefund(-1, [pay(4500)])).toBe("amountNegative");
  });

  it("counts earlier refunds against the remaining balance", () => {
    expect(refuseRefund(3600, [pay(4500), refund(1000)])).toBe("refundExceedsPaid");
    expect(refuseRefund(3500, [pay(4500), refund(1000)])).toBeNull();
  });

  it("ignores voided entries on both sides", () => {
    expect(refuseRefund(1000, [pay(4500), refund(4500, VOIDED)])).toBeNull();
    expect(refuseRefund(1000, [pay(4500, VOIDED)])).toBe("refundOnEmpty");
  });
});

describe("refuseVoid", () => {
  it("allows voiding the only payment on a booking", () => {
    expect(refuseVoid([])).toBeNull();
  });

  it("allows voiding one of two payments", () => {
    expect(refuseVoid([pay(2000)])).toBeNull();
  });

  // The case from review: take 100, refund 100, then void the payment. The
  // refund would be left standing against money that was never received.
  it("refuses a void that would leave a refund unopposed", () => {
    expect(refuseVoid([refund(10000)])).toBe("voidLeavesNegative");
  });

  it("refuses when the remaining refunds outweigh the remaining payments", () => {
    expect(refuseVoid([pay(2000), refund(4500)])).toBe("voidLeavesNegative");
  });

  // The way out: void the refund first, which always leaves a sane net.
  it("allows voiding the refund instead", () => {
    expect(refuseVoid([pay(10000)])).toBeNull();
  });

  it("allows a void that leaves exactly zero", () => {
    expect(refuseVoid([pay(4500), refund(4500)])).toBeNull();
  });

  // Entries already voided are not "remaining" in any sense that matters, and
  // netReceivedMinor drops them, so a stale one cannot make a void look unsafe.
  it("ignores entries that were already voided", () => {
    expect(refuseVoid([refund(10000, VOIDED)])).toBeNull();
  });
});

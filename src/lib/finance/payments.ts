// What a booking's payments add up to, and whether a new entry is allowed.
//
// PURE, like ../auth/access: no Prisma, no session, no env. The actions read the
// rows and ask these; the tests are rows of data rather than a database.
//
// THE THREE MONEY COLUMNS ARE NOT INTERCHANGEABLE (D6):
//   amount    what was actually received, AFTER the discount.
//   discount  the price reduction given. It settles the booking without any
//             money moving, so it counts toward "is this paid" — but it is
//             never revenue, because nobody received it.
//   tip       extra on top. Never revenue, never part of a payout base, and
//             never counted toward settling the price. It is still cash in the
//             drawer, which is why it is stored rather than discarded: the
//             shift close (phase 3) adds it to expected cash.
//
// A REFUND is a row of its own (kind REFUND), never an edit of the payment it
// reverses, and carries no discount and no tip.

/** The fields these rules read. Anything with these shapes will do. */
export interface PaymentEntry {
  kind: "PAYMENT" | "REFUND";
  amountMinor: number;
  discountMinor: number;
  tipMinor: number;
  voidedAt: Date | null;
}

/** A voided entry never counts, anywhere. It exists to show what was undone. */
export function isLive(entry: Pick<PaymentEntry, "voidedAt">): boolean {
  return entry.voidedAt === null;
}

/**
 * Money actually received, net of refunds: payments minus refunds, voids
 * ignored. Discounts are NOT in here (nobody handed them over) and neither are
 * tips (not the salon's revenue). This is the number revenue is built from.
 */
export function netReceivedMinor(entries: readonly PaymentEntry[]): number {
  return entries
    .filter(isLive)
    .reduce((sum, e) => sum + (e.kind === "REFUND" ? -e.amountMinor : e.amountMinor), 0);
}

/**
 * How much of the price has been settled: received money PLUS discounts given,
 * minus refunds. This is the "is the booking square" number, not the revenue
 * one — a comped booking is fully settled and earns nothing.
 */
export function settledMinor(entries: readonly PaymentEntry[]): number {
  return entries
    .filter(isLive)
    .reduce(
      (sum, e) =>
        e.kind === "REFUND" ? sum - e.amountMinor : sum + e.amountMinor + e.discountMinor,
      0,
    );
}

/** Tips taken, net of nothing: a tip is never refunded through this column. */
export function tipsMinor(entries: readonly PaymentEntry[]): number {
  return entries.filter(isLive).reduce((sum, e) => sum + e.tipMinor, 0);
}

/**
 * Where a booking stands.
 *   paid    — settled >= price. A comped booking (discount = price) is paid.
 *   partial — something has been settled, but not the whole price. There is
 *             deliberately no "debt" concept in this phase: short of the price
 *             is simply partial, whatever the reason.
 *   unpaid  — nothing live on the booking (or it all came back as refunds).
 */
export type PaymentStatus = "unpaid" | "partial" | "paid";

export function paymentStatusOf(entries: readonly PaymentEntry[], priceMinor: number): PaymentStatus {
  const settled = settledMinor(entries);
  // A zero-price booking with nothing on it is settled by definition; checking
  // paid first is what makes that true rather than "unpaid".
  if (settled >= priceMinor) return "paid";
  if (settled > 0) return "partial";
  return "unpaid";
}

/** What a booking's payment block shows. One shape for the popup and the badge. */
export interface PaymentSummary {
  status: PaymentStatus;
  /** Received minus refunded. Revenue reads this; the customer never sees it. */
  netReceivedMinor: number;
  /** Received + discounts − refunds: how much of the price is accounted for. */
  settledMinor: number;
  /** Price − settled, floored at zero. What the "record payment" form prefills. */
  remainingMinor: number;
  tipsMinor: number;
}

export function summarize(
  entries: readonly PaymentEntry[],
  priceMinor: number,
): PaymentSummary {
  const settled = settledMinor(entries);
  return {
    status: paymentStatusOf(entries, priceMinor),
    netReceivedMinor: netReceivedMinor(entries),
    settledMinor: settled,
    remainingMinor: Math.max(0, priceMinor - settled),
    tipsMinor: tipsMinor(entries),
  };
}

// --- Validation -------------------------------------------------------------

/**
 * Why an entry was refused, or null when it is fine. A key, not a sentence: the
 * action turns it into the caller's language.
 *
 *   amountNegative    / discountNegative — below zero.
 *   amountRequired    — the amount is zero where one is needed (a refund of
 *                       nothing). "Enter an amount", not "the amount is negative".
 *   emptyEntry        — amount and discount both zero: a row that moves nothing.
 *                       (A tip alone is not a payment; it rides a real one.)
 *   exceedsPrice      — this payment would settle more than the booking costs.
 *                       Change over the price is a TIP, in the tip field.
 *   refundExceedsPaid — refunding more than was ever received.
 *   refundOnEmpty     — refunding a booking with nothing received.
 *   voidLeavesNegative — voiding this entry would leave refunds standing against
 *                       a payment that is no longer there.
 */
export type PaymentRefusal =
  | "amountNegative"
  | "discountNegative"
  | "tipNegative"
  | "amountRequired"
  | "emptyEntry"
  | "exceedsPrice"
  | "refundExceedsPaid"
  | "refundOnEmpty"
  | "voidLeavesNegative";

export interface NewPayment {
  amountMinor: number;
  discountMinor: number;
  tipMinor: number;
}

/**
 * May this PAYMENT be added to a booking that already has `existing`?
 *
 * The overpay rule is on the SETTLED total, and the tip is deliberately outside
 * it: handing over 50 ₼ for a 45 ₼ service is a 45 ₼ payment and a 5 ₼ tip, not
 * a 50 ₼ payment. Letting the amount absorb it would quietly inflate revenue and
 * every payout computed from it.
 */
export function refuseNewPayment(
  entry: NewPayment,
  existing: readonly PaymentEntry[],
  priceMinor: number,
): PaymentRefusal | null {
  if (entry.amountMinor < 0) return "amountNegative";
  if (entry.discountMinor < 0) return "discountNegative";
  if (entry.tipMinor < 0) return "tipNegative";
  if (entry.amountMinor + entry.discountMinor <= 0) return "emptyEntry";
  if (settledMinor(existing) + entry.amountMinor + entry.discountMinor > priceMinor) {
    return "exceedsPrice";
  }
  return null;
}

/**
 * May an entry be voided, given the OTHER live entries that would remain?
 *
 * Voiding is not free: take 100, refund 100, then void the payment, and the
 * refund is left standing against money the booking never received — a net of
 * −100, which is not a state any later total can make sense of. Revenue would
 * go negative, and so would the master's payout base. So the refunds come off
 * first, and this says so rather than letting the row through.
 *
 * Pass the entries that would be left, NOT including the one being voided.
 */
export function refuseVoid(remaining: readonly PaymentEntry[]): PaymentRefusal | null {
  if (netReceivedMinor(remaining) < 0) return "voidLeavesNegative";
  return null;
}

/**
 * May this REFUND be added? Only against money actually received — a discount is
 * not refundable, because nothing was handed over to give back.
 */
export function refuseRefund(
  amountMinor: number,
  existing: readonly PaymentEntry[],
): PaymentRefusal | null {
  if (amountMinor < 0) return "amountNegative";
  // An empty form field is not a negative number, and telling someone their
  // amount is negative when they simply have not typed one is a bad message.
  if (amountMinor === 0) return "amountRequired";
  const received = netReceivedMinor(existing);
  if (received <= 0) return "refundOnEmpty";
  if (amountMinor > received) return "refundExceedsPaid";
  return null;
}

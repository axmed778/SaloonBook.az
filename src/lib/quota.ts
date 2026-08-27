import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { limitsFor } from "./plans";
import { effectivePlan, subscriptionForSalon, type SubscriptionLike } from "./subscription";
import { bakuPeriodYm } from "./time";

// Monthly booking-quota accounting, shared by every path that spends it. It
// lives in its own module rather than in booking.ts because a NEW BOOKING is not
// the only spender: a customer-initiated reschedule writes a fresh confirmation,
// a fresh T-24h reminder and an owner alert — outbound WhatsApp the salon pays
// for on its plan. That path used to skip the accounting entirely, so whoever
// held a manage link could loop reschedules and burn unlimited messages.

export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

/**
 * Charge one monthly-quota slot to the salon, throwing PlanLimitError when the
 * plan has none left. Must run inside the same transaction as the write it
 * guards: the increment is the guard.
 *
 * Atomic on purpose — increment first, then validate. The row lock on
 * UsageCounter serializes concurrent callers, so the post-increment value is
 * unique per transaction and an over-limit attempt rolls back its own increment
 * when it throws, closing the check-then-increment race.
 *
 * Pass `subscription` when the caller already loaded it (booking does), else it
 * is resolved from the salon.
 */
export async function consumeBookingQuota(
  tx: Prisma.TransactionClient,
  salonId: string,
  opts: { subscription?: SubscriptionLike | null } = {},
): Promise<void> {
  const sub =
    opts.subscription !== undefined ? opts.subscription : await subscriptionForSalon(tx, salonId);
  const plan = effectivePlan(sub);
  const maxBookings = limitsFor(plan).maxBookingsPerMonth;

  const periodYm = bakuPeriodYm(new Date());
  const usage = await tx.usageCounter.upsert({
    where: { salonId_periodYm: { salonId, periodYm } },
    create: { salonId, periodYm, bookings: 1 },
    update: { bookings: { increment: 1 } },
    select: { bookings: true },
  });
  if (Number.isFinite(maxBookings) && usage.bookings > maxBookings) {
    throw new PlanLimitError(
      `Monthly booking limit reached for the ${plan} plan (${maxBookings}).`,
    );
  }
}

/**
 * Give a booking's monthly-quota slot back. Only called when STAFF cancel an
 * appointment (src/app/[locale]/dashboard/actions.ts).
 *
 * The counter measures booking *activity*, not live appointments: a customer
 * cancelling or rescheduling never gets a slot back, otherwise a "book, cancel,
 * repeat" (or "reschedule in a loop") sequence would let a FREE salon exceed its
 * quota indefinitely. Staff cancellation is the one exception, because the
 * asymmetry was exploitable from outside: thirty spam bookings with thirty
 * different numbers exhaust a FREE salon's month and cancelling them did nothing
 * for the counter, so every real customer was refused until the 1st with no way
 * to reset it from the UI. Requiring a staff action keeps the loop closed while
 * giving the salon a way out of someone else's abuse.
 *
 * Keyed on when the booking was CREATED, not on today: a January booking
 * cancelled in February was counted against January, and decrementing February
 * would both leave January stuck and hand the salon a free slot in a month it
 * never spent one. It releases exactly ONE slot per appointment (the caller
 * guards on the previous status), so the extra slots a reschedule spends in
 * later months are never handed back — they paid for messages actually sent. The
 * `bookings: { gt: 0 }` guard makes a double release (or a release against a
 * counter that was never incremented) a no-op rather than an underflow.
 */
export async function releaseBookingQuota(
  salonId: string,
  bookedAt: Date,
): Promise<void> {
  await prisma.usageCounter.updateMany({
    where: { salonId, periodYm: bakuPeriodYm(bookedAt), bookings: { gt: 0 } },
    data: { bookings: { decrement: 1 } },
  });
}

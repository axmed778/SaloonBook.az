// Send-time decisions that do not depend on the recipient: may this salon send
// this message at all?
//
// PURE, like ./auth/access: no Prisma, no queue, no env. The worker reads the
// salon row and asks this, so the rule is covered by the unit suite — which runs
// `vitest run src` and does not reach worker/.

import type { SalonStatus } from "@prisma/client";

/**
 * Notices that exist BECAUSE an appointment is off. Every guard that stops a
 * message going out exempts them: suppressing one leaves a customer expecting a
 * visit that is not happening, which is worse than the message it withholds.
 */
const CANCELLATION_NOTICES = new Set(["appointment_cancelled", "booking_cancelled_alert"]);

export function isCancellationNotice(template: string): boolean {
  return CANCELLATION_NOTICES.has(template);
}

/**
 * May a salon in this state still send `template`?
 *
 * A salon that is not ACTIVE has closed: the owner suspended the branch, or it
 * was deleted. It takes no new commitments — the public /book route and the
 * manage link's reschedule already refuse one — but its queue still holds
 * reminders for appointments booked while it was open, and a delayed reminder
 * job lives in Redis for up to weeks. Nothing was stopping those: they keep
 * arriving on customers' phones, telling them to come to a salon that is shut.
 *
 * Cancellation notices stay allowed, on the rule the manage route already draws
 * ("takes no new commitments; cancelling above stays allowed"). A closing branch
 * is exactly when a customer needs to hear their appointment is off.
 *
 * `status` is nullable for a salon row that no longer resolves. That is not a
 * licence to send, so it fails closed.
 */
export function salonMaySend(status: SalonStatus | null | undefined, template: string): boolean {
  if (isCancellationNotice(template)) return true;
  return status === "ACTIVE";
}

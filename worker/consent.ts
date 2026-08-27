import type { BookingSource } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

// WHO a template's message is addressed to, and therefore what still has to
// hold at SEND time. A notification can sit in the queue for a day (the T-24h
// reminder), and consent can be withdrawn in that window — an inbound "STOP"
// clears Customer.waOptIn (see the WhatsApp webhook) but cannot reach into
// Redis to drop jobs that were already scheduled. So the check has to happen
// here, immediately before the send, not only at creation time.
//
// Salon-facing alerts go to the business's own number: the salon is our
// customer, not a marketing recipient, and it must keep learning that a booking
// arrived or was cancelled.
const SALON_FACING = new Set([
  "new_booking_alert",
  "booking_cancelled_alert",
  "appointment_rescheduled_alert",
]);

// Strictly transactional customer messages: a reply to something the person
// just did (booked) or something being done to their booking (the salon
// cancelled it). These are service messages, never marketing, and suppressing
// them would leave the customer with a booking nobody ever confirmed — so they
// go out regardless of marketing consent. This is the distinction booking.ts
// draws at creation time (`isPublic || customer.waOptIn`); it is mirrored here
// rather than re-derived, so the two cannot drift apart.
const TRANSACTIONAL = new Set(["booking_confirmation", "appointment_cancelled"]);

export interface ConsentAppointment {
  source: BookingSource;
  consentAt: Date | null;
  customer: { waOptIn: boolean };
}

/**
 * May we still send this notification to this recipient?
 *
 * Everything except a customer-facing REMINDER is permitted unconditionally
 * (see the sets above). The reminder is the one message we initiate later, on
 * our own schedule, so it is the one that must re-read consent.
 *
 * A reminder is permitted when either:
 *  - the customer holds marketing consent right now (waOptIn), or
 *  - the customer submitted this booking themselves on the public page and
 *    accepted the data-processing consent while doing so (source=PUBLIC +
 *    consentAt). They asked us for this appointment from this number, which is
 *    what makes a reminder about it a utility message rather than an outreach.
 *
 * Which leaves the case this closes: a staff-entered (DASHBOARD) booking, whose
 * reminder only ever existed because waOptIn was true at creation. Once that
 * flag is cleared — the customer replied STOP — the reminder must not fire.
 *
 * KNOWN GAP (needs a schema change, so not fixable from the worker): the webhook
 * records an opt-out by flipping waOptIn true->false, and a public self-booker
 * who never ticked the optional marketing box is already false. So "opted out"
 * and "never opted in" are indistinguishable for that group, and their reminders
 * still go out. Recording the withdrawal explicitly (a `waOptOutAt` column set
 * by the webhook) would let the second bullet above become
 * `... && customer.waOptOutAt === null` and close it.
 */
export async function messagingStillPermitted(input: {
  salonId: string;
  toPhone: string;
  template: string;
  appointment: ConsentAppointment | null;
}): Promise<boolean> {
  const { template, appointment } = input;
  if (SALON_FACING.has(template) || TRANSACTIONAL.has(template)) return true;

  // Reminders (and any future customer-facing template) need the live flag. It
  // normally rides along on the appointment the notification already loaded;
  // a row without an appointment is matched on (salon, phone) instead.
  const customer =
    appointment?.customer ??
    (await prisma.customer.findUnique({
      where: { salonId_phone: { salonId: input.salonId, phone: input.toPhone } },
      select: { waOptIn: true },
    }));
  // No customer record at all — nothing was ever consented to or withdrawn, and
  // blocking here would silently drop messages to numbers we never tracked.
  if (!customer) return true;
  if (customer.waOptIn) return true;

  return appointment !== null && appointment.source === "PUBLIC" && appointment.consentAt !== null;
}

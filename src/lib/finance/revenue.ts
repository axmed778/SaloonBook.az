// What the salon earned. THE definition, and from now on the only one.
//
// PURE: no Prisma, no session. Callers pass the bookings and their payments.
//
// Revenue is money RECEIVED, net of refunds, on bookings that actually resolved:
//
//   net payments (payments − refunds, voids ignored)
//   on bookings that are COMPLETED, CANCELLED or NO_SHOW
//
// Three things follow, and each of them is the point:
//
//   * A discount is not revenue. Nobody handed it over. A fully comped booking
//     is settled and earns zero.
//   * A tip is not revenue. It is the master's, not the salon's, and it is never
//     part of a payout base either (D6).
//   * A CANCELLED or NO_SHOW booking with no payment contributes nothing, but
//     one with a kept prepayment contributes exactly that. So this is precisely
//     "completed bookings plus kept prepayments" — no separate rule needed.
//
// CONFIRMED bookings never count: the work has not happened, and money taken up
// front is a deposit until it does.
//
// NOT to be confused with "booked value" — the sum of Appointment.priceMinor —
// which is what analytics, client LTV, the exports and the old payroll screen
// show (D8). That is what was PROMISED; this is what ARRIVED. Both are real
// numbers; they answer different questions, and the screens say which is which.
//
// WHICH PERIOD (D7): revenue belongs to the BOOKING's day, not the payment's.
// A visit on the 30th paid for on the 1st is the 30th's revenue. Callers group
// by the booking, which is why this takes bookings rather than loose payments.
// AppointmentPayment.businessDate — the payment day — is the shift's key in
// phase 3 and is deliberately not used here.

import { netReceivedMinor, type PaymentEntry } from "./payments";

/** Booking statuses whose money is earned. */
const RESOLVED = new Set(["COMPLETED", "CANCELLED", "NO_SHOW"]);

export function isRevenueBearing(status: string): boolean {
  return RESOLVED.has(status);
}

export interface RevenueBooking {
  status: string;
  payments: readonly PaymentEntry[];
}

/** Revenue earned by one booking: zero unless it resolved. */
export function bookingRevenueMinor(booking: RevenueBooking): number {
  if (!isRevenueBearing(booking.status)) return 0;
  return netReceivedMinor(booking.payments);
}

/** Revenue over a set of bookings. */
export function revenueMinor(bookings: readonly RevenueBooking[]): number {
  return bookings.reduce((sum, b) => sum + bookingRevenueMinor(b), 0);
}

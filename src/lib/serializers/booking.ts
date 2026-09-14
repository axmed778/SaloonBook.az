// The single funnel every booking passes through on its way to a client.
//
// A master runs their own day: they need the client's NAME, the service, the
// date and the time. They do not need the client's phone number, and the salon
// does not want them to have it — a masters' book of the salon's customer
// contacts is how a master leaves and takes the clientele with them.
//
// "Not shown" is not the requirement. The number must never reach the device:
//   * not in a JSON body,
//   * not in Next.js's RSC payload, which is inlined into the dashboard's HTML
//     as flight data and is fully readable with View Source even when nothing
//     renders it — hiding a field with CSS or a conditional in a client
//     component leaves it right there in the page,
//   * not in a CSV/print export.
//
// So the rule is enforced twice, and both halves live here:
//   1. bookingSelectForViewer() — a query for a viewer without contact access
//      does not SELECT the contact columns at all, so the row in memory has
//      nothing to leak.
//   2. serializeBookingForViewer() — every booking that becomes a prop or a
//      response body goes through this, and for such a viewer the contact keys
//      are ABSENT from the object (not null, not "***"). A key that does not
//      exist cannot be serialized by accident, and `"customerPhone" in booking`
//      is a test anyone can write against any new endpoint.
//
// Who is such a viewer is decided by a permission, not a role: whoever may read
// the client base (clients.read) sees contacts, and nobody else does. There is
// deliberately no setting or toggle that turns this off.

import type { Permission } from "../auth/permissions";
import { redactContactsOrNull } from "./redact-notes";

/**
 * How much of a customer a viewer may see on a booking:
 *   FULL       — contact details, and the service note verbatim;
 *   NO_CONTACT — no contact details, and the service note with any contact cut out.
 */
export type BookingViewer = "FULL" | "NO_CONTACT";

/**
 * The viewer for a dashboard session. One place decides it, so a new page
 * cannot invent its own — and cannot get it backwards.
 */
export function bookingViewer(session: {
  isAdmin: boolean;
  permissions: readonly Permission[];
}): BookingViewer {
  // The platform admin has no membership, and so no permissions, but is trusted
  // with everything an owner sees.
  if (session.isAdmin) return "FULL";
  // Fail closed: a role that may not read the client base gets no contact
  // details. A role added later starts without them and has to be granted
  // clients.read, rather than inheriting contacts by omission.
  return session.permissions.includes("clients.read") ? "FULL" : "NO_CONTACT";
}

/**
 * May this viewer see the customer's contact details? Only the phone hangs off
 * this now: the service note is shown to every viewer, redacted for NO_CONTACT —
 * see serializeBookingForViewer().
 */
export function canSeeCustomerContact(viewer: BookingViewer): boolean {
  return viewer === "FULL";
}

/**
 * Keys that must never appear in anything a NO_CONTACT viewer receives. The
 * service note is NOT one of them — a master needs it to do the job, and it
 * arrives with any contact inside it already cut out (redact-notes.ts).
 */
export const CONTACT_KEYS = ["customerPhone", "phone", "clientPhone", "tel", "whatsapp", "email"] as const;

// --- Prisma selects ---------------------------------------------------------

/**
 * The `customer` sub-select for a booking query. A NO_CONTACT viewer gets id +
 * name and nothing else — the phone column is not read, so no later mistake can
 * expose it. (Customer has no email/whatsapp column; if one is ever added it
 * must be added to the FULL branch here and nowhere else.)
 */
export function bookingCustomerSelect(viewer: BookingViewer) {
  return canSeeCustomerContact(viewer)
    ? { id: true, name: true, phone: true }
    : { id: true, name: true };
}

/**
 * Everything the dashboard's booking surfaces (today list, calendar, export)
 * read about an appointment, narrowed by viewer. Shared on purpose: one select
 * means one place to audit, and a new surface that copies it gets the rule for
 * free.
 */
export function bookingSelectForViewer(viewer: BookingViewer) {
  return {
    id: true,
    employeeId: true,
    startsAt: true,
    endsAt: true,
    createdAt: true,
    status: true,
    source: true,
    autoCompleted: true,
    priceMinor: true,
    manageToken: true,
    attendeeName: true,
    service: { select: { name: true } },
    // The add-ons as booked (snapshots). Part of the job, so every viewer reads
    // them; priceMinor above already includes their prices.
    addons: { select: { name: true }, orderBy: { name: "asc" as const } },
    employee: { select: { name: true, position: true } },
    customer: { select: bookingCustomerSelect(viewer) },
    // Read for every viewer. A master sees the service note — it is how they
    // know the customer wants a dark shade — and serializeBookingForViewer()
    // strips any contact out of it on the way to them.
    serviceNote: true,
  };
}

// --- Serialization ----------------------------------------------------------

/** An appointment row as bookingSelectForViewer() returns it. */
export interface BookingRow {
  id: string;
  employeeId: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  status: string;
  source: string;
  autoCompleted: boolean;
  priceMinor: number;
  manageToken: string;
  attendeeName: string | null;
  service: { name: string };
  addons: { name: string }[];
  employee: { name: string; position: string | null };
  customer: { id: string; name: string; phone?: string };
  serviceNote: string | null;
}

export type BookingStatus = "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";

/**
 * A booking as the client may see it. The contact field is optional because
 * for a NO_CONTACT viewer it is genuinely missing, not empty — check with
 * `if (booking.customerPhone)` and a master's UI simply has no phone row and no
 * WhatsApp button to render.
 */
export interface SerializedBooking {
  id: string;
  employeeId: string;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
  status: BookingStatus;
  source: string;
  autoCompleted: boolean;
  priceMinor: number;
  /** Capability token for the customer's own /a/{token} page. Not contact data:
   *  that page and its API expose the appointment, never the phone. */
  manageToken: string;
  serviceName: string;
  /** Add-ons booked on top of the service ("French", "Nail art"); may be empty. */
  addonNames: string[];
  employeeName: string;
  employeePosition: string | null;
  customerId: string;
  /** Who the booking is for: the attendee's name when the booker named someone
   *  else (a child, a parent), otherwise the customer's own name. */
  customerName: string;
  /** FULL viewers only. Absent — not null, not masked — for a master. */
  customerPhone?: string;
  /**
   * The customer's wish for the service ("tünd çalar", "allergiya var").
   * Present for every viewer, but for NO_CONTACT any phone/email/handle inside
   * it has been replaced with [gizli] here, on the server, before it could reach
   * the RSC payload. FULL viewers get it verbatim.
   */
  serviceNote: string | null;
}

/**
 * Redacts one booking for one viewer. Every response and every prop carrying a
 * booking goes through this; nothing else is allowed to hand a raw Prisma row
 * to a client component or a Response body.
 */
export function serializeBookingForViewer(
  booking: BookingRow,
  viewer: BookingViewer,
): SerializedBooking {
  const base: SerializedBooking = {
    id: booking.id,
    employeeId: booking.employeeId,
    startsAt: booking.startsAt,
    endsAt: booking.endsAt,
    createdAt: booking.createdAt,
    status: booking.status as BookingStatus,
    source: booking.source,
    autoCompleted: booking.autoCompleted,
    priceMinor: booking.priceMinor,
    manageToken: booking.manageToken,
    serviceName: booking.service.name,
    addonNames: booking.addons.map((a) => a.name),
    employeeName: booking.employee.name,
    employeePosition: booking.employee.position,
    customerId: booking.customer.id,
    customerName: booking.attendeeName ?? booking.customer.name,
    // Redacted for NO_CONTACT, verbatim for FULL. Booking endpoints already
    // refuse a note with a contact in it, so in practice this only fires on rows
    // written before that rule existed — and on anything that gets past it. Two
    // locks, not one.
    serviceNote: canSeeCustomerContact(viewer)
      ? (booking.serviceNote ?? null)
      : redactContactsOrNull(booking.serviceNote),
  };
  if (!canSeeCustomerContact(viewer)) return base;
  // FULL. The phone is still only added when the query actually read it, so a
  // caller that forgot the right select gets a missing key rather than
  // `undefined` masquerading as a value.
  return {
    ...base,
    ...(booking.customer.phone !== undefined ? { customerPhone: booking.customer.phone } : {}),
  };
}

/** serializeBookingForViewer over a list. */
export function serializeBookingsForViewer(
  bookings: BookingRow[],
  viewer: BookingViewer,
): SerializedBooking[] {
  return bookings.map((b) => serializeBookingForViewer(b, viewer));
}

/**
 * Test/audit helper: every contact-ish key found anywhere in a payload, however
 * deeply nested. Used by the regression test that asserts a master's booking
 * response carries none of them.
 */
export function findContactKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((v, i) => findContactKeys(v, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => {
      const here = `${path}.${k}`;
      const hit = (CONTACT_KEYS as readonly string[]).includes(k) ? [here] : [];
      return [...hit, ...findContactKeys(v, here)];
    });
  }
  return [];
}

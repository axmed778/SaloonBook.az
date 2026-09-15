import { describe, it, expect } from "vitest";
import type { SalonStatus } from "@prisma/client";
import { isCancellationNotice, salonMaySend } from "./notification-gate";

// The templates the worker actually queues (src/lib/booking.ts and the manage
// route), split by who they are addressed to.
const CUSTOMER_FACING = ["booking_confirmation", "appointment_reminder"];
const SALON_FACING = ["new_booking_alert", "appointment_rescheduled_alert"];
const CANCELLATIONS = ["appointment_cancelled", "booking_cancelled_alert"];

describe("isCancellationNotice", () => {
  it.each(CANCELLATIONS)("recognises %s", (template) => {
    expect(isCancellationNotice(template)).toBe(true);
  });

  it.each([...CUSTOMER_FACING, ...SALON_FACING])("does not claim %s", (template) => {
    expect(isCancellationNotice(template)).toBe(false);
  });
});

describe("salonMaySend", () => {
  it.each([...CUSTOMER_FACING, ...SALON_FACING, ...CANCELLATIONS])(
    "lets an active salon send %s",
    (template) => {
      expect(salonMaySend("ACTIVE", template)).toBe(true);
    },
  );

  // The bug this closes: a branch suspended today still had weeks of T-24h
  // reminders sitting in Redis for bookings taken while it was open.
  const closed: SalonStatus[] = ["SUSPENDED", "DELETED"];

  it.each(closed)("stops a %s salon reminding customers", (status) => {
    for (const template of CUSTOMER_FACING) {
      expect(salonMaySend(status, template), template).toBe(false);
    }
  });

  it.each(closed)("stops a %s salon alerting itself", (status) => {
    for (const template of SALON_FACING) {
      expect(salonMaySend(status, template), template).toBe(false);
    }
  });

  it.each(closed)("still lets a %s salon tell customers an appointment is off", (status) => {
    for (const template of CANCELLATIONS) {
      expect(salonMaySend(status, template), template).toBe(true);
    }
  });

  it("fails closed when the salon row no longer resolves", () => {
    expect(salonMaySend(null, "appointment_reminder")).toBe(false);
    expect(salonMaySend(undefined, "appointment_reminder")).toBe(false);
  });

  it("still sends a cancellation when the salon row no longer resolves", () => {
    expect(salonMaySend(null, "appointment_cancelled")).toBe(true);
  });
});

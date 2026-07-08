import { Prisma } from "@prisma/client";
import { enqueueNotification } from "./queue";
import { limitsFor } from "./plans";
import { effectivePlan } from "./subscription";
import { bakuPeriodYm } from "./time";
import { withTenantScope } from "./tenant";
import { isSlotBookable, type SlotRejectReason } from "./availability";
import { sanitizeTemplateParam } from "./whatsapp";

export class SlotTakenError extends Error {
  constructor() {
    super("That time was just booked. Please pick another slot.");
    this.name = "SlotTakenError";
  }
}

/** The requested slot is not bookable per the availability rules (past, outside
 *  working hours, during time-off, or the service no longer exists). */
export class SlotUnavailableError extends Error {
  constructor(public readonly reason: SlotRejectReason) {
    super("That time isn't available for booking. Please pick another slot.");
    this.name = "SlotUnavailableError";
  }
}

export class PlanLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

export interface CreateBookingInput {
  salonId: string;
  serviceId: string;
  employeeId: string;
  startUtc: Date;
  customer: { name: string; phone: string; waOptIn?: boolean };
  source?: "PUBLIC" | "DASHBOARD";
}

export interface CreateBookingResult {
  appointmentId: string;
  manageToken: string;
  startUtc: Date;
  endUtc: Date;
}

// A Postgres exclusion_violation (23P01) from the appointment_no_overlap
// constraint surfaces through Prisma as a raw error; detect it by signature.
// Exported for the reschedule path, which updates startsAt/endsAt directly.
export function isOverlapError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (
    msg.includes("appointment_no_overlap") ||
    msg.includes("23P01") ||
    msg.includes("exclusion")
  );
}

/**
 * Creates a CONFIRMED appointment. Booking is the only thing that blocks the
 * customer: plan limits and overlap are enforced inside one transaction (with
 * the DB exclusion constraint as the hard guarantee), then WhatsApp jobs are
 * pushed to the queue and we return immediately — the worker does the rest.
 */
export async function createBooking(input: CreateBookingInput): Promise<CreateBookingResult> {
  const source = input.source ?? "PUBLIC";
  const periodYm = bakuPeriodYm(new Date());

  // Sanitize the client-supplied name once: it is stored and later flows into
  // the owner's WhatsApp alert (and, eventually, the dashboard).
  const safeName = sanitizeTemplateParam(input.customer.name);

  const result = await withTenantScope(input.salonId, async (tx) => {
    const salon = await tx.salon.findUnique({
      where: { id: input.salonId },
      select: { id: true, name: true, phone: true, account: { select: { subscription: true } } },
    });
    if (!salon) throw new Error("Salon not found");

    const service = await tx.service.findFirst({
      where: { id: input.serviceId, salonId: input.salonId, isActive: true },
      select: { id: true, name: true, durationMin: true, bufferMin: true, priceMinor: true },
    });
    if (!service) throw new Error("Service not found");

    // --- Re-validate the requested slot on the write side (parity with the
    // availability read path). The overlap exclusion constraint only blocks
    // collisions with other CONFIRMED appointments; this also rejects past,
    // out-of-working-hours, and time-off slots that a direct /book call could
    // otherwise smuggle in. ---
    const check = await isSlotBookable(tx, {
      employeeId: input.employeeId,
      serviceId: service.id,
      startUtc: input.startUtc,
    });
    if (!check.ok) {
      if (check.reason === "overlap") throw new SlotTakenError();
      throw new SlotUnavailableError(check.reason);
    }
    const endUtc = check.endUtc;

    // --- Plan booking-limit enforcement (Free = 50/month) ---
    // Atomic guard: increment first, then validate. The row lock on
    // UsageCounter serializes concurrent bookings, so the post-increment value
    // is unique per transaction and an over-limit attempt rolls back its own
    // increment when it throws — closing the check-then-increment race.
    //
    // INTENTIONAL: the counter is NOT decremented when a booking is later
    // cancelled or rescheduled. The monthly quota measures booking *activity*,
    // not live appointments — otherwise a "book, cancel, repeat" loop would let
    // a FREE salon exceed 50/month indefinitely. A FREE salon with heavy
    // cancellations can therefore hit the wall before 50 live bookings.
    const plan = effectivePlan(salon.account.subscription);
    const maxBookings = limitsFor(plan).maxBookingsPerMonth;
    const usage = await tx.usageCounter.upsert({
      where: { salonId_periodYm: { salonId: input.salonId, periodYm } },
      create: { salonId: input.salonId, periodYm, bookings: 1 },
      update: { bookings: { increment: 1 } },
      select: { bookings: true },
    });
    if (Number.isFinite(maxBookings) && usage.bookings > maxBookings) {
      throw new PlanLimitError(
        `Monthly booking limit reached for the ${plan} plan (${maxBookings}).`,
      );
    }

    // Public bookings are unauthenticated: never let a booking with someone
    // else's phone rewrite their existing customer record. Create only when
    // absent; otherwise reuse the existing row untouched. Dashboard bookings
    // (staff-entered) keep the prior upsert-overwrite behavior.
    const isPublic = source === "PUBLIC";
    const customer = await tx.customer.upsert({
      where: { salonId_phone: { salonId: input.salonId, phone: input.customer.phone } },
      create: {
        salonId: input.salonId,
        name: safeName,
        phone: input.customer.phone,
        waOptIn: input.customer.waOptIn ?? false,
      },
      update: isPublic
        ? {}
        : {
            name: safeName,
            ...(input.customer.waOptIn !== undefined ? { waOptIn: input.customer.waOptIn } : {}),
          },
      select: { id: true },
    });

    let appointment;
    try {
      appointment = await tx.appointment.create({
        data: {
          salonId: input.salonId,
          employeeId: input.employeeId,
          serviceId: service.id,
          customerId: customer.id,
          startsAt: input.startUtc,
          endsAt: endUtc,
          status: "CONFIRMED",
          priceMinor: service.priceMinor,
          source,
        },
        select: { id: true, manageToken: true, startsAt: true, endsAt: true },
      });
    } catch (e) {
      if (isOverlapError(e)) throw new SlotTakenError();
      throw e;
    }

    // Persist the WhatsApp notifications (worker sends them).
    const confirmation = await tx.notification.create({
      data: {
        salonId: input.salonId,
        appointmentId: appointment.id,
        template: "booking_confirmation",
        toPhone: input.customer.phone,
        payload: {
          salon: salon.name,
          service: service.name,
          startsAt: appointment.startsAt.toISOString(),
        } satisfies Prisma.InputJsonValue,
      },
      select: { id: true },
    });

    // Only persist a reminder when it's still in the future. For a booking less
    // than 24h out the reminder is moot, and creating it would leave a QUEUED
    // row that never enqueues (delay <= 0) and lingers forever.
    const reminderAt = new Date(appointment.startsAt.getTime() - 24 * 60 * 60_000);
    let reminderId: string | null = null;
    if (reminderAt > new Date()) {
      const reminder = await tx.notification.create({
        data: {
          salonId: input.salonId,
          appointmentId: appointment.id,
          template: "appointment_reminder",
          toPhone: input.customer.phone,
          sendAfter: reminderAt,
          payload: {
            salon: salon.name,
            service: service.name,
            startsAt: appointment.startsAt.toISOString(),
          } satisfies Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      reminderId = reminder.id;
    }

    let ownerAlertId: string | null = null;
    if (salon.phone) {
      const ownerAlert = await tx.notification.create({
        data: {
          salonId: input.salonId,
          appointmentId: appointment.id,
          template: "new_booking_alert",
          toPhone: salon.phone,
          payload: {
            customer: safeName,
            service: service.name,
            startsAt: appointment.startsAt.toISOString(),
          } satisfies Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      ownerAlertId = ownerAlert.id;
    }

    return {
      appointment,
      confirmationId: confirmation.id,
      ownerAlertId,
      reminderId,
      reminderSendAfter: reminderAt,
    };
  });

  // --- After commit: push to the queue, best-effort AND time-bounded. The
  // booking already succeeded, so a slow/unreachable Redis must neither fail nor
  // DELAY the response. The Notification rows are persisted (status QUEUED) and
  // can be swept later, so we race the enqueue against a short timeout. ---
  try {
    await Promise.race([
      (async () => {
        await enqueueNotification(result.confirmationId);
        if (result.ownerAlertId) await enqueueNotification(result.ownerAlertId);

        if (result.reminderId) {
          const reminderDelay = result.reminderSendAfter.getTime() - Date.now();
          if (reminderDelay > 0) {
            await enqueueNotification(result.reminderId, reminderDelay);
          }
        }
      })(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("enqueue timed out")), 2000),
      ),
    ]);
  } catch (e) {
    console.error(
      "[booking] enqueue failed/timed out (booking committed; relying on persisted QUEUED rows)",
      e,
    );
  }

  return {
    appointmentId: result.appointment.id,
    manageToken: result.appointment.manageToken,
    startUtc: result.appointment.startsAt,
    endUtc: result.appointment.endsAt,
  };
}

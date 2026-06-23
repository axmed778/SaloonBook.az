import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { enqueueNotification } from "./queue";
import { limitsFor } from "./plans";
import { bakuPeriodYm } from "./time";

export class SlotTakenError extends Error {
  constructor() {
    super("That time was just booked. Please pick another slot.");
    this.name = "SlotTakenError";
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
  startUtc: Date;
  endUtc: Date;
}

// A Postgres exclusion_violation (23P01) from the appointment_no_overlap
// constraint surfaces through Prisma as a raw error; detect it by signature.
function isOverlapError(e: unknown): boolean {
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

  const result = await prisma.$transaction(async (tx) => {
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

    // --- Plan booking-limit enforcement (Free = 50/month) ---
    const plan = salon.account.subscription?.plan ?? "FREE";
    const maxBookings = limitsFor(plan).maxBookingsPerMonth;
    if (Number.isFinite(maxBookings)) {
      const usage = await tx.usageCounter.findUnique({
        where: { salonId_periodYm: { salonId: input.salonId, periodYm } },
        select: { bookings: true },
      });
      if ((usage?.bookings ?? 0) >= maxBookings) {
        throw new PlanLimitError(
          `Monthly booking limit reached for the ${plan} plan (${maxBookings}).`,
        );
      }
    }

    const endUtc = new Date(
      input.startUtc.getTime() + (service.durationMin + service.bufferMin) * 60_000,
    );

    const customer = await tx.customer.upsert({
      where: { salonId_phone: { salonId: input.salonId, phone: input.customer.phone } },
      create: {
        salonId: input.salonId,
        name: input.customer.name,
        phone: input.customer.phone,
        waOptIn: input.customer.waOptIn ?? false,
      },
      update: {
        name: input.customer.name,
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
        select: { id: true, startsAt: true, endsAt: true },
      });
    } catch (e) {
      if (isOverlapError(e)) throw new SlotTakenError();
      throw e;
    }

    await tx.usageCounter.upsert({
      where: { salonId_periodYm: { salonId: input.salonId, periodYm } },
      create: { salonId: input.salonId, periodYm, bookings: 1 },
      update: { bookings: { increment: 1 } },
    });

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

    const reminder = await tx.notification.create({
      data: {
        salonId: input.salonId,
        appointmentId: appointment.id,
        template: "appointment_reminder",
        toPhone: input.customer.phone,
        sendAfter: new Date(appointment.startsAt.getTime() - 24 * 60 * 60_000),
        payload: {
          salon: salon.name,
          service: service.name,
          startsAt: appointment.startsAt.toISOString(),
        } satisfies Prisma.InputJsonValue,
      },
      select: { id: true, sendAfter: true },
    });

    let ownerAlertId: string | null = null;
    if (salon.phone) {
      const ownerAlert = await tx.notification.create({
        data: {
          salonId: input.salonId,
          appointmentId: appointment.id,
          template: "new_booking_alert",
          toPhone: salon.phone,
          payload: {
            customer: input.customer.name,
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
      reminderId: reminder.id,
      reminderSendAfter: reminder.sendAfter,
    };
  });

  // --- After commit: push to the queue. Booking already succeeded. ---
  await enqueueNotification(result.confirmationId);
  if (result.ownerAlertId) await enqueueNotification(result.ownerAlertId);

  const reminderDelay = result.reminderSendAfter.getTime() - Date.now();
  if (reminderDelay > 0) {
    await enqueueNotification(result.reminderId, reminderDelay);
  }

  return {
    appointmentId: result.appointment.id,
    startUtc: result.appointment.startsAt,
    endUtc: result.appointment.endsAt,
  };
}

import { Prisma } from "@prisma/client";
import { enqueueNotification, enqueuePush } from "./queue";
import { limitsFor } from "./plans";
import { effectivePlan } from "./subscription";
import { prisma } from "./prisma";
import { bakuPeriodYm } from "./time";
import { withTenantScope } from "./tenant";
import { isSlotBookable, type SlotRejectReason } from "./availability";
import { sanitizeTemplateParam } from "./whatsapp";

/**
 * How far ahead a PUBLIC booking may land. Bounds calendar-stuffing abuse via
 * direct /book calls (unauthenticated + client-supplied phone). The reschedule
 * path enforces the same cap. Dashboard (staff) bookings are NOT capped — a
 * salon can legitimately book itself further out.
 */
export const MAX_BOOKING_AHEAD_DAYS = 60;

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
  /** `waOptIn` is MARKETING consent only (news/offers), never the gate for this
   *  booking's own confirmation and reminder — see the notification block below.
   *  Callers must only pass true when the phone's owner actually said so; the
   *  public route requires an OTP-verified session for the same number. */
  customer: { name: string; phone: string; waOptIn?: boolean };
  /** Free-text booking note from the customer (e.g. preferred hair colour).
   *  Stored on the appointment and shown to the salon; never sent over WhatsApp. */
  notes?: string;
  /** Customer's data-processing consent (public self-booking). Records the
   *  document version accepted; absent for staff-entered bookings. */
  consent?: { version: string };
  source?: "PUBLIC" | "DASHBOARD";
}

/**
 * Give a booking's monthly-quota slot back. Only called when STAFF cancel an
 * appointment (src/app/[locale]/dashboard/actions.ts) — see the reasoning at
 * the increment site.
 *
 * Keyed on when the booking was CREATED, not on today: a January booking
 * cancelled in February was counted against January, and decrementing February
 * would both leave January stuck and hand the salon a free slot in a month it
 * never spent one. The `bookings: { gt: 0 }` guard makes a double release (or a
 * release against a counter that was never incremented) a no-op rather than an
 * underflow.
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
  // Booking note is dashboard-only (never a WhatsApp param), so it just needs
  // trimming + a length cap; React escapes it on display.
  const safeNotes = input.notes?.trim().slice(0, 500) || null;

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

    // --- Plan booking-limit enforcement (FREE = 30/month, see PLAN_LIMITS) ---
    // Atomic guard: increment first, then validate. The row lock on
    // UsageCounter serializes concurrent bookings, so the post-increment value
    // is unique per transaction and an over-limit attempt rolls back its own
    // increment when it throws — closing the check-then-increment race.
    //
    // The counter is NOT decremented when a customer cancels or reschedules. The
    // monthly quota measures booking *activity*, not live appointments —
    // otherwise a "book, cancel, repeat" loop would let a FREE salon exceed its
    // quota indefinitely.
    //
    // Staff cancellation is the one exception (releaseBookingQuota below), and it
    // exists because the asymmetry was exploitable from outside: thirty spam
    // bookings with thirty different numbers exhaust a FREE salon's month, and
    // cancelling them did nothing for the counter, so every real customer was
    // refused until the 1st with no way to reset it from the UI. Requiring a
    // staff action to release keeps the loop closed — a customer cannot trigger
    // one — while giving the salon a way out of someone else's abuse.
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
      select: { id: true, waOptIn: true },
    });

    let appointment;
    try {
      appointment = await tx.appointment.create({
        data: {
          salonId: input.salonId,
          employeeId: input.employeeId,
          serviceId: service.id,
          customerId: customer.id,
          // The name entered for THIS booking — may differ from the contact's
          // (Customer) name when one phone books for several people.
          attendeeName: safeName,
          notes: safeNotes,
          consentAt: input.consent ? new Date() : null,
          consentVersion: input.consent?.version ?? null,
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

    // Two different consents, previously conflated into one flag.
    //
    // A booking's own confirmation and T-24h reminder are TRANSACTIONAL: the
    // person just asked for this appointment from this number, and the reminder
    // is the whole reason a salon buys the product. They used to be gated on
    // waOptIn, whose public-form checkbox reads "receive news, offers and
    // promotions (optional)" and defaults to OFF — so a customer who booked and
    // left the box alone got nothing at all. The reschedule path in
    // api/public/manage/[token] never had that gate, which is the behaviour
    // being made consistent here.
    //
    // waOptIn stays what its label says: marketing. It still gates anything the
    // salon initiates later, and staff-entered (DASHBOARD) bookings still need
    // it, because there the customer never asked us for anything.
    //
    // The reminder is additionally gated on being far enough out (a <24h
    // booking's reminder is moot and would linger QUEUED).
    const notifyCustomer = isPublic || customer.waOptIn;
    const reminderAt = new Date(appointment.startsAt.getTime() - 24 * 60 * 60_000);
    let confirmationId: string | null = null;
    let reminderId: string | null = null;
    if (notifyCustomer) {
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
      confirmationId = confirmation.id;

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
      confirmationId,
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
        if (result.confirmationId) await enqueueNotification(result.confirmationId);
        if (result.ownerAlertId) await enqueueNotification(result.ownerAlertId);

        if (result.reminderId) {
          const reminderDelay = result.reminderSendAfter.getTime() - Date.now();
          if (reminderDelay > 0) {
            await enqueueNotification(result.reminderId, reminderDelay);
          }
        }

        // PWA push to the salon's installed devices: a new-booking alert (parity
        // with the owner WhatsApp alert, but independent of salon.phone), plus a
        // T-2h reminder (the WhatsApp reminder is at T-24h). Skip the reminder if
        // the appointment is already within 2h.
        await enqueuePush({ type: "new_booking", appointmentId: result.appointment.id });
        const pushReminderDelay =
          result.appointment.startsAt.getTime() - 2 * 60 * 60_000 - Date.now();
        if (pushReminderDelay > 0) {
          await enqueuePush(
            { type: "reminder", appointmentId: result.appointment.id },
            pushReminderDelay,
          );
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

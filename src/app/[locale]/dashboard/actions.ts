"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getSession, setActiveBranch } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { enqueueNotification } from "@/lib/queue";
import { getAvailableSlots, type Slot } from "@/lib/availability";
import {
  createBooking,
  SlotTakenError,
  SlotUnavailableError,
  PlanLimitError,
} from "@/lib/booking";

// Server actions backing the dashboard calendar: staff-entered ("manual")
// bookings and appointment status changes. Every action re-derives the caller's
// salon from the session and scopes writes to it — the tenant guard is `salonId`
// in the where-filter, exactly like the other dashboard actions.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSalonId(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  return session.salonId;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The (employee, service) pair must belong to this salon and be linked/active. */
async function assertServiceLink(
  salonId: string,
  serviceId: string,
  employeeId: string,
): Promise<boolean> {
  const link = await prisma.serviceEmployee.findFirst({
    where: {
      serviceId,
      employeeId,
      service: { salonId, isActive: true },
      employee: { salonId, isActive: true },
    },
    select: { serviceId: true },
  });
  return Boolean(link);
}

// --- Available slots for the manual-booking form ---------------------------

const slotsSchema = z.object({
  employeeId: z.string().uuid(),
  serviceId: z.string().uuid(),
  day: z.string().regex(YMD_RE),
});

export type SlotsResult =
  | { ok: true; slots: Slot[] }
  | { ok: false; error: string };

export async function availableSlots(input: unknown): Promise<SlotsResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Actions");
  const parsed = slotsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { employeeId, serviceId, day } = parsed.data;

  // Never expose availability for a pair that isn't this tenant's.
  if (!(await assertServiceLink(salonId, serviceId, employeeId))) {
    return { ok: false, error: t("serviceNotOffered") };
  }

  const slots = await getAvailableSlots({ employeeId, serviceId, dayYmd: day });
  return { ok: true, slots };
}

// --- Create a manual (dashboard) booking ------------------------------------

const bookingSchema = z.object({
  employeeId: z.string().uuid(),
  serviceId: z.string().uuid(),
  startUtc: z.string().datetime(), // ISO instant from the availableSlots response
  name: z
    .string()
    .trim()
    .min(1, "Müştəri adı tələb olunur.")
    .max(120)
    .regex(/[\p{L}\p{N}]/u, "Ad hərf və ya rəqəm daxil etməlidir."),
  phone: z
    .string()
    .regex(/^\+994\d{9}$/, "Telefon +994XXXXXXXXX formatında olmalıdır."),
  notes: z.string().max(500).optional(),
});

export async function createManualBooking(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Actions");
  const parsed = bookingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const d = parsed.data;

  if (!(await assertServiceLink(salonId, d.serviceId, d.employeeId))) {
    return { ok: false, error: t("serviceNotOffered") };
  }

  try {
    // Reuse the same write path as public bookings: slot re-validation, plan
    // limit, overlap constraint and WhatsApp notifications all apply. source
    // DASHBOARD keeps the existing customer record's name/opt-in untouched only
    // for public bookings — a staff entry may correct them.
    await createBooking({
      salonId,
      serviceId: d.serviceId,
      employeeId: d.employeeId,
      startUtc: new Date(d.startUtc),
      customer: { name: d.name, phone: d.phone },
      notes: d.notes,
      source: "DASHBOARD",
    });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return { ok: false, error: t("slotTaken") };
    }
    if (e instanceof SlotUnavailableError) {
      return {
        ok: false,
        error: t.has(`slotReason.${e.reason}`) ? t(`slotReason.${e.reason}`) : t("slotUnavailable"),
      };
    }
    if (e instanceof PlanLimitError) {
      return { ok: false, error: t("planLimit") };
    }
    console.error("[manual-booking] error", e);
    return { ok: false, error: t("bookingFailed") };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Switch the active branch (multi-branch / Pro owners) --------------------

const switchBranchSchema = z.object({ salonId: z.string().uuid() });

/**
 * Sets the sb_branch cookie that getSession() reads, re-scoping the WHOLE
 * dashboard (calendar, clients, services, workers, payroll, analytics) to the
 * chosen branch. Owner-only, Pro-only, and only to a branch of the caller's own
 * account — everything else is a silent no-op error.
 */
export async function switchBranch(input: unknown): Promise<ActionResult> {
  const session = await getSession();
  const t = await getTranslations("Actions");
  const parsed = switchBranchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  if (
    !session ||
    session.role !== "OWNER" ||
    !session.multiBranch ||
    !session.branches.some((b) => b.id === parsed.data.salonId)
  ) {
    return { ok: false, error: t("invalidData") };
  }

  await setActiveBranch(parsed.data.salonId);
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Change an appointment's status -----------------------------------------

const statusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["COMPLETED", "NO_SHOW", "CANCELLED"]),
});

export async function setAppointmentStatus(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Actions");
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { id, status } = parsed.data;

  // Pre-read for the cancellation notice below (previous status, phone, names).
  const appt = await prisma.appointment.findFirst({
    where: { id, salonId },
    select: {
      status: true,
      startsAt: true,
      customer: { select: { phone: true } },
      service: { select: { name: true } },
      salon: { select: { name: true } },
    },
  });
  if (!appt) return { ok: false, error: t("apptNotFound") };

  // salonId in the filter is the tenant guard; only CONFIRMED/COMPLETED/NO_SHOW
  // appointments are shown, so any of them is a valid transition target.
  const res = await prisma.appointment.updateMany({
    where: { id, salonId },
    data: { status },
  });
  if (res.count === 0) return { ok: false, error: t("apptNotFound") };

  // A cancelled/no-showed appointment must not message the customer: cancel any
  // still-queued notifications (e.g. the T-24h reminder). The worker re-checks
  // the appointment status too, so this is belt-and-braces for races.
  if (status === "CANCELLED" || status === "NO_SHOW") {
    await prisma.notification.updateMany({
      where: { appointmentId: id, salonId, status: "QUEUED" },
      data: { status: "CANCELLED" },
    });
  }

  // Salon cancelled an upcoming confirmed appointment → tell the customer so
  // they don't show up. Created AFTER the sweep above so it stays QUEUED; the
  // worker exempts cancellation notices from the cancelled-appointment guard.
  if (status === "CANCELLED" && appt.status === "CONFIRMED" && appt.startsAt > new Date()) {
    const notice = await prisma.notification.create({
      data: {
        salonId,
        appointmentId: id,
        template: "appointment_cancelled",
        toPhone: appt.customer.phone,
        payload: {
          salon: appt.salon.name,
          service: appt.service.name,
          startsAt: appt.startsAt.toISOString(),
        },
      },
      select: { id: true },
    });
    // Best-effort: the row is persisted QUEUED either way.
    try {
      await enqueueNotification(notice.id);
    } catch (e) {
      console.error("[status] cancel-notice enqueue failed (row persisted)", e);
    }
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

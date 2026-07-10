"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { assertEmployeeSeatAvailable } from "@/lib/subscription";
import { bakuDayBoundsUtc, bakuToday } from "@/lib/time";

// Server actions for the Workers (İşçilər) screen. Every action re-derives the
// caller's salon from the session and scopes writes to it. In MVP an account has
// exactly one salon, so an employee is implicitly attached to session.salonId —
// the "an employee must belong to a branch" rule. A branch selector goes here
// when multi-branch (Pro) ships.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSalonId(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  return session.salonId;
}

const hourSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMin: z.number().int().min(0).max(1440),
    endMin: z.number().int().min(0).max(1440),
  })
  .refine((h) => h.endMin > h.startMin, {
    message: "İş saatının bitməsi başlanğıcdan sonra olmalıdır.",
  });

const employeeSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1, "Ad tələb olunur.").max(120),
    position: z.string().trim().max(120).nullish(),
    phone: z.string().trim().max(32).nullish(),
    isActive: z.boolean(),
    audience: z.enum(["MALE", "FEMALE", "ALL"]),
    serviceIds: z.array(z.string().uuid()).max(200),
    hours: z.array(hourSchema).max(28),
  })
  // The client can only emit one window per weekday, but a crafted request could
  // send overlapping windows for the same day — which would surface as duplicate
  // slots in the booking UI. Reject overlaps server-side (split shifts that don't
  // overlap are still allowed).
  .superRefine((d, ctx) => {
    const byDay = new Map<number, { startMin: number; endMin: number }[]>();
    for (const h of d.hours) {
      const arr = byDay.get(h.weekday) ?? [];
      arr.push(h);
      byDay.set(h.weekday, arr);
    }
    for (const windows of byDay.values()) {
      windows.sort((a, b) => a.startMin - b.startMin);
      for (let i = 1; i < windows.length; i++) {
        if (windows[i].startMin < windows[i - 1].endMin) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Eyni gün üçün iş saatları üst-üstə düşür.",
          });
          return;
        }
      }
    }
  });

export async function saveEmployee(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Yanlış məlumat." };
  }
  const d = parsed.data;

  // Only allow assigning services that actually belong to this salon.
  const validServices = d.serviceIds.length
    ? await prisma.service.findMany({
        where: { id: { in: d.serviceIds }, salonId },
        select: { id: true },
      })
    : [];
  const serviceIds = validServices.map((s) => s.id);

  try {
    await prisma.$transaction(async (tx) => {
      // Plan seat limit: only ACTIVE employees consume seats, so creating an
      // active one or re-activating an existing one must pass the check.
      if (d.isActive) {
        await assertEmployeeSeatAvailable(tx, salonId, d.id);
      }

      let employeeId: string;
      if (d.id) {
        const res = await tx.employee.updateMany({
          where: { id: d.id, salonId }, // salonId in filter = tenant guard
          data: {
            name: d.name,
            position: d.position || null,
            phone: d.phone || null,
            isActive: d.isActive,
            audience: d.audience,
          },
        });
        if (res.count === 0) throw new Error("İşçi tapılmadı.");
        employeeId = d.id;
      } else {
        const emp = await tx.employee.create({
          data: {
            salonId,
            name: d.name,
            position: d.position || null,
            phone: d.phone || null,
            isActive: d.isActive,
            audience: d.audience,
          },
          select: { id: true },
        });
        employeeId = emp.id;
      }

      // Replace the service links.
      await tx.serviceEmployee.deleteMany({ where: { employeeId } });
      if (serviceIds.length) {
        await tx.serviceEmployee.createMany({
          data: serviceIds.map((serviceId) => ({ serviceId, employeeId })),
        });
      }

      // Replace the weekly working hours.
      await tx.workingHour.deleteMany({ where: { employeeId } });
      if (d.hours.length) {
        await tx.workingHour.createMany({
          data: d.hours.map((h) => ({
            employeeId,
            weekday: h.weekday,
            startMin: h.startMin,
            endMin: h.endMin,
          })),
        });
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Yadda saxlanmadı." };
  }

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard"); // calendar columns depend on the employee list
  return { ok: true };
}

export async function setEmployeeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const salonId = await requireSalonId();
  try {
    await prisma.$transaction(async (tx) => {
      // Re-activating consumes a plan seat — same check as saveEmployee.
      if (isActive) await assertEmployeeSeatAvailable(tx, salonId, id);
      await tx.employee.updateMany({ where: { id, salonId }, data: { isActive } });
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Yadda saxlanmadı." };
  }
  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Time off ---------------------------------------------------------------
// Whole Baku calendar days, [from..to] inclusive. The availability engine
// already excludes TimeOff intervals from bookable slots — this is just the
// management surface for it.

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

const timeOffSchema = z
  .object({
    employeeId: z.string().uuid(),
    from: z.string().regex(YMD_RE),
    to: z.string().regex(YMD_RE),
    reason: z.string().trim().max(200).nullish(),
  })
  .refine((d) => d.from <= d.to, { message: "Bitmə tarixi başlanğıcdan əvvəl ola bilməz." });

export async function addTimeOff(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const parsed = timeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Yanlış məlumat." };
  }
  const d = parsed.data;

  if (d.to < bakuToday()) {
    return { ok: false, error: "Keçmiş tarix üçün məzuniyyət əlavə edilə bilməz." };
  }

  // Tenant guard: the employee must belong to this salon.
  const employee = await prisma.employee.findFirst({
    where: { id: d.employeeId, salonId },
    select: { id: true },
  });
  if (!employee) return { ok: false, error: "İşçi tapılmadı." };

  const startsAt = bakuDayBoundsUtc(d.from).startUtc;
  const endsAt = bakuDayBoundsUtc(d.to).endUtc; // exclusive: start of the day after `to`

  // Cap the range so a typo (e.g. year 2062) can't block the calendar forever.
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000) {
    return { ok: false, error: "Məzuniyyət 1 ildən uzun ola bilməz." };
  }

  await prisma.timeOff.create({
    data: { employeeId: d.employeeId, startsAt, endsAt, reason: d.reason || null },
  });

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard"); // frees/blocks calendar slots
  return { ok: true };
}

export async function deleteTimeOff(id: string): Promise<ActionResult> {
  const salonId = await requireSalonId();
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Yanlış məlumat." };

  const res = await prisma.timeOff.deleteMany({
    where: { id, employee: { salonId } },
  });
  if (res.count === 0) return { ok: false, error: "Qeyd tapılmadı." };

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteEmployee(id: string): Promise<ActionResult> {
  const salonId = await requireSalonId();
  try {
    const res = await prisma.employee.deleteMany({ where: { id, salonId } });
    if (res.count === 0) return { ok: false, error: "İşçi tapılmadı." };
  } catch {
    // FK violation: appointments reference this employee. Keep history — steer to
    // deactivate instead of destroying it.
    return {
      ok: false,
      error: "Bu işçidə görüşlər var. Silmək əvəzinə onu deaktiv edin.",
    };
  }
  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard");
  return { ok: true };
}

"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireOwnerSalonId, requireOwnerSession } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordIssues } from "@/lib/auth/password";
import { featuresFor } from "@/lib/plans";
import {
  assertEmployeeSeatAvailable,
  effectivePlan,
  subscriptionForSalon,
} from "@/lib/subscription";
import { bakuDayBoundsUtc, bakuToday } from "@/lib/time";

// Server actions for the Workers (İşçilər) screen. Every action re-derives the
// caller's salon from the session and scopes writes to it. In MVP an account has
// exactly one salon, so an employee is implicitly attached to session.salonId —
// the "an employee must belong to a branch" rule. A branch selector goes here
// when multi-branch (Pro) ships.

export type ActionResult = { ok: true } | { ok: false; error: string };


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
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Workers.errors");
  const parsed = employeeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
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
        if (res.count === 0) throw new Error(t("notFound"));
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
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
  }

  // Same as setEmployeeActive: an edit that switches the master off closes
  // their login, so it must close their devices too.
  if (d.id && !d.isActive) await silenceStaffDevices(salonId, d.id);

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard"); // calendar columns depend on the employee list
  return { ok: true };
}

export async function setEmployeeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Workers.errors");
  try {
    await prisma.$transaction(async (tx) => {
      // Re-activating consumes a plan seat — same check as saveEmployee.
      if (isActive) await assertEmployeeSeatAvailable(tx, salonId, id);
      await tx.employee.updateMany({ where: { id, salonId }, data: { isActive } });
    });
    // Deactivating already blocks the login on the next request (see
    // getSession); this stops the notifications their phone would keep getting.
    if (!isActive) await silenceStaffDevices(salonId, id);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
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
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Workers.errors");
  const parsed = timeOffSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const d = parsed.data;

  if (d.to < bakuToday()) {
    return { ok: false, error: t("timeOffPast") };
  }

  // Tenant guard: the employee must belong to this salon.
  const employee = await prisma.employee.findFirst({
    where: { id: d.employeeId, salonId },
    select: { id: true },
  });
  if (!employee) return { ok: false, error: t("notFound") };

  const startsAt = bakuDayBoundsUtc(d.from).startUtc;
  const endsAt = bakuDayBoundsUtc(d.to).endUtc; // exclusive: start of the day after `to`

  // Cap the range so a typo (e.g. year 2062) can't block the calendar forever.
  if (endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000) {
    return { ok: false, error: t("timeOffTooLong") };
  }

  await prisma.timeOff.create({
    data: { employeeId: d.employeeId, startsAt, endsAt, reason: d.reason || null },
  });

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard"); // frees/blocks calendar slots
  return { ok: true };
}

export async function deleteTimeOff(id: string): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Workers.errors");
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: t("invalidData") };

  const res = await prisma.timeOff.deleteMany({
    where: { id, employee: { salonId } },
  });
  if (res.count === 0) return { ok: false, error: t("recordNotFound") };

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteEmployee(id: string): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Workers.errors");
  try {
    await prisma.$transaction(async (tx) => {
      // Take the master's login with them. The membership's employee relation is
      // optional, so the FK would otherwise just null out `employeeId` and leave
      // working credentials behind that no screen lists any more.
      await revokeAccessRows(tx, salonId, id);
      const res = await tx.employee.deleteMany({ where: { id, salonId } });
      if (res.count === 0) throw new Error("not-found");
    });
  } catch (e) {
    if (e instanceof Error && e.message === "not-found") {
      return { ok: false, error: t("notFound") };
    }
    // FK violation: appointments reference this employee. Keep history — steer to
    // deactivate instead of destroying it.
    return { ok: false, error: t("hasAppointments") };
  }
  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Per-master logins ------------------------------------------------------
// A master signs in with their own email + password and lands on a dashboard
// holding exactly their own day: their column of the calendar, their bookings,
// nothing about the salon's money, clients or colleagues (see lib/auth/access).
//
// The credential is deliberately thin: the owner sets the password and hands it
// over. There is no invite email — most masters here are handed the login in
// person, and a mail round-trip is one more thing to go wrong on day one. They
// can change it later through the normal password-reset flow.

/** Tx-safe client: these helpers run both inside and outside a transaction. */
type Tx = Prisma.TransactionClient;

/**
 * Owner of a salon whose CURRENT plan includes staff logins. The plan is
 * re-read from the subscription rather than trusted from the session, for the
 * same reason payroll does: stale UI must not be able to grant an entitlement
 * the account has stopped paying for.
 */
async function requireStaffAccessOwner(): Promise<{ salonId: string; accountId: string }> {
  const session = await requireOwnerSession();
  const salonId = session.salonId!;
  const sub = await subscriptionForSalon(prisma, salonId);
  if (!featuresFor(effectivePlan(sub)).staffRoles) {
    const t = await getTranslations("Workers.errors");
    throw new Error(t("accessPlan"));
  }
  return { salonId, accountId: session.accountId! };
}

/**
 * Unsubscribes a master's installed devices.
 *
 * The worker fans push notifications out by SALON, not by user (see
 * worker/processors/push.ts) — so a device left subscribed keeps receiving every
 * booking the salon takes, with the customer's name in the body, long after the
 * login behind it stopped working. Closing the login has to close the devices.
 */
async function dropStaffDevices(tx: Tx, userId: string): Promise<void> {
  await tx.pushSubscription.deleteMany({ where: { userId } });
}

/**
 * Cuts the devices of a master who is still on the books but can no longer sign
 * in — deactivated rather than revoked. Their subscription would otherwise
 * outlive the block, which is the same leak by a quieter door.
 */
async function silenceStaffDevices(salonId: string, employeeId: string): Promise<void> {
  const membership = await prisma.membership.findFirst({
    where: { employeeId, salonId, role: "STAFF" },
    select: { userId: true },
  });
  if (membership) await dropStaffDevices(prisma, membership.userId);
}

/**
 * Drops a master's login: the devices, the membership, and the user behind it
 * when that user exists for no other reason. Shared by revokeStaffAccess and
 * deleteEmployee.
 */
async function revokeAccessRows(tx: Tx, salonId: string, employeeId: string): Promise<void> {
  const membership = await tx.membership.findFirst({
    where: { employeeId, salonId, role: "STAFF" },
    select: { id: true, userId: true },
  });
  if (!membership) return;

  await dropStaffDevices(tx, membership.userId);
  await tx.membership.delete({ where: { id: membership.id } });

  // A staff user is created for exactly one membership, but check rather than
  // assume: deleting a user who had grown a second membership would lock them
  // out of a salon this action was never asked to touch.
  const others = await tx.membership.count({ where: { userId: membership.userId } });
  if (others === 0) {
    await tx.passwordResetToken.deleteMany({ where: { userId: membership.userId } });
    await tx.user.delete({ where: { id: membership.userId } });
  } else {
    // Left in place, so at least end the sessions this login already had.
    await tx.user.update({
      where: { id: membership.userId },
      data: { sessionsValidFrom: new Date() },
    });
  }
}

const grantSchema = z.object({
  employeeId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export async function grantStaffAccess(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("Workers.errors");
  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("accessEmailInvalid") };
  const d = parsed.data;

  // Same policy as owner signup — a master's login opens the same dashboard.
  const issues = passwordIssues(d.password);
  if (issues.length > 0) {
    const tp = await getTranslations("Auth.passwordIssues");
    return { ok: false, error: issues.map((c) => tp(c)).join(" ") };
  }

  try {
    const { salonId, accountId } = await requireStaffAccessOwner();
    const passwordHash = await hashPassword(d.password);

    await prisma.$transaction(async (tx) => {
      // The master must be one of ours, and still working here: a login for a
      // deactivated employee would be refused at sign-in anyway.
      const employee = await tx.employee.findFirst({
        where: { id: d.employeeId, salonId },
        select: { id: true, name: true, isActive: true, membership: { select: { id: true } } },
      });
      if (!employee) throw new Error(t("notFound"));
      if (!employee.isActive) throw new Error(t("accessInactive"));
      if (employee.membership) throw new Error(t("accessExists"));

      const taken = await tx.user.findUnique({
        where: { email: d.email },
        select: { id: true },
      });
      if (taken) throw new Error(t("accessEmailTaken"));

      const user = await tx.user.create({
        data: { email: d.email, fullName: employee.name, passwordHash },
        select: { id: true },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          accountId,
          role: "STAFF",
          // Both of these are what confines the login: the branch it belongs to
          // and the master it speaks for.
          salonId,
          employeeId: employee.id,
        },
      });
    });
  } catch (e) {
    // A concurrent grant with the same email loses the unique index, not the
    // transaction's read.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: t("accessEmailTaken") };
    }
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

const resetSchema = z.object({
  employeeId: z.string().uuid(),
  password: z.string().min(1).max(200),
});

export async function resetStaffPassword(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("Workers.errors");
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  const issues = passwordIssues(parsed.data.password);
  if (issues.length > 0) {
    const tp = await getTranslations("Auth.passwordIssues");
    return { ok: false, error: issues.map((c) => tp(c)).join(" ") };
  }

  try {
    const { salonId } = await requireStaffAccessOwner();
    const passwordHash = await hashPassword(parsed.data.password);

    const membership = await prisma.membership.findFirst({
      where: { employeeId: parsed.data.employeeId, salonId, role: "STAFF" },
      select: { userId: true },
    });
    if (!membership) return { ok: false, error: t("accessMissing") };

    // Cut the old sessions too. A password is usually reset because the last one
    // leaked or the phone it was typed into is gone; leaving the existing
    // cookies valid would make the reset cosmetic.
    await prisma.user.update({
      where: { id: membership.userId },
      data: { passwordHash, sessionsValidFrom: new Date() },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function revokeStaffAccess(employeeId: string): Promise<ActionResult> {
  const t = await getTranslations("Workers.errors");
  if (!z.string().uuid().safeParse(employeeId).success) {
    return { ok: false, error: t("invalidData") };
  }

  try {
    // Revoking is deliberately NOT plan-gated: an account that lost the feature
    // must still be able to take a login away.
    const session = await requireOwnerSession();
    await prisma.$transaction((tx) => revokeAccessRows(tx, session.salonId!, employeeId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth/guards";
import {
  appRoleOf,
  canAssignRole,
  isTeamRole,
  spansAllBranches,
  TEAM_ROLES,
  type TeamRole,
} from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordIssues } from "@/lib/auth/password";
import { assertEmployeeSeatAvailable } from "@/lib/subscription";
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
  const { salonId } = await requirePermission("staff.manage");
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
  revalidatePath("/dashboard/time-off");
  revalidatePath("/dashboard"); // calendar columns depend on the employee list
  return { ok: true };
}

export async function setEmployeeActive(id: string, isActive: boolean): Promise<ActionResult> {
  const { salonId } = await requirePermission("staff.manage");
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
  revalidatePath("/dashboard/time-off");
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Time off ---------------------------------------------------------------
// Whole Baku calendar days, [from..to] inclusive. The availability engine
// already excludes TimeOff intervals from bookable slots — this is just the
// management surface for it, used from both the Staff and the Time off screens.

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
  const { salonId } = await requirePermission("schedule.write");
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
  revalidatePath("/dashboard/time-off");
  revalidatePath("/dashboard"); // frees/blocks calendar slots
  return { ok: true };
}

export async function deleteTimeOff(id: string): Promise<ActionResult> {
  const { salonId } = await requirePermission("schedule.write");
  const t = await getTranslations("Workers.errors");
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: t("invalidData") };

  const res = await prisma.timeOff.deleteMany({
    where: { id, employee: { salonId } },
  });
  if (res.count === 0) return { ok: false, error: t("recordNotFound") };

  revalidatePath("/dashboard/workers");
  revalidatePath("/dashboard/time-off");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteEmployee(id: string): Promise<ActionResult> {
  const { salonId } = await requirePermission("staff.manage");
  const t = await getTranslations("Workers.errors");
  try {
    await prisma.$transaction(async (tx) => {
      // Take the master's login with them. The membership's employee relation is
      // optional, so the FK would otherwise just null out `employeeId` and leave
      // working credentials behind that no screen lists any more. A reception or
      // finance login linked to the employee stays: it only loses the link.
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
  revalidatePath("/dashboard/time-off");
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Per-master logins ------------------------------------------------------
// A master signs in with their own email + password and lands on a dashboard
// holding exactly their own day: their column of the calendar, their bookings,
// nothing about the salon's money, clients or colleagues (see lib/auth/permissions).
//
// The credential is deliberately thin: the owner sets the password and hands it
// over. There is no invite email — most masters here are handed the login in
// person, and a mail round-trip is one more thing to go wrong on day one. They
// can change it later through the normal password-reset flow.
//
// Handing a login out is plan-gated through canAssignRole(), which reads the
// session's plan — re-derived from the subscription on every request, so stale
// UI cannot grant an entitlement the account has stopped paying for. Taking one
// away never is.

/** Tx-safe client: these helpers run both inside and outside a transaction. */
type Tx = Prisma.TransactionClient;

/**
 * Unsubscribes a login's installed devices.
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
 * Drops a login: the devices, the membership, and the user behind it when that
 * user exists for no other reason. Shared by every revoke on this screen.
 */
async function dropLogin(tx: Tx, membership: { id: string; userId: string }): Promise<void> {
  await dropStaffDevices(tx, membership.userId);
  await tx.membership.delete({ where: { id: membership.id } });

  // A login's user is created for exactly one membership, but check rather than
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

/** Drops a master's own login, if they have one. */
async function revokeAccessRows(tx: Tx, salonId: string, employeeId: string): Promise<void> {
  const membership = await tx.membership.findFirst({
    where: { employeeId, salonId, role: "STAFF" },
    select: { id: true, userId: true },
  });
  if (membership) await dropLogin(tx, membership);
}

const grantSchema = z.object({
  employeeId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export async function grantStaffAccess(input: unknown): Promise<ActionResult> {
  const session = await requirePermission("staff.manage");
  const t = await getTranslations("Workers.errors");
  if (!canAssignRole(session, "MASTER")) return { ok: false, error: t("accessPlan") };

  const parsed = grantSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("accessEmailInvalid") };
  const d = parsed.data;

  // Same policy as owner signup — a master's login opens the same dashboard.
  const issues = passwordIssues(d.password);
  if (issues.length > 0) {
    const tp = await getTranslations("Auth.passwordIssues");
    return { ok: false, error: issues.map((c) => tp(c)).join(" ") };
  }

  const { salonId } = session;
  try {
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
          accountId: session.accountId!,
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
  const session = await requirePermission("staff.manage");
  const t = await getTranslations("Workers.errors");
  if (!canAssignRole(session, "MASTER")) return { ok: false, error: t("accessPlan") };

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  const issues = passwordIssues(parsed.data.password);
  if (issues.length > 0) {
    const tp = await getTranslations("Auth.passwordIssues");
    return { ok: false, error: issues.map((c) => tp(c)).join(" ") };
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);

    const membership = await prisma.membership.findFirst({
      where: { employeeId: parsed.data.employeeId, salonId: session.salonId, role: "STAFF" },
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
  // Revoking is deliberately NOT plan-gated: an account that lost the feature
  // must still be able to take a login away.
  const { salonId } = await requirePermission("staff.manage");
  const t = await getTranslations("Workers.errors");
  if (!z.string().uuid().safeParse(employeeId).success) {
    return { ok: false, error: t("invalidData") };
  }

  try {
    await prisma.$transaction((tx) => revokeAccessRows(tx, salonId, employeeId));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

// --- Team logins: reception and finance -------------------------------------
// The owner creates these on this screen too. They are not employees: no
// calendar column, no staff seat. Reception is pinned to the branch it was
// created in; finance spans the account, so it has no branch of its own. Either
// may be linked to an employee, only so that person can later see their own
// payout statement — the link widens nothing (see salonScopeFor).
//
// Creating one, re-opening one and resetting its password need roles.assign on
// a plan that includes the role. Switching one off and revoking it need only
// staff.manage, which no plan gates, so a lapsed account can still close them.

const PLAN_REQUIRED = {
  ADMIN: "planAdmin",
  FINANCE: "planFinance",
} as const satisfies Record<TeamRole, string>;

const teamCreateSchema = z.object({
  role: z.enum(TEAM_ROLES),
  fullName: z.string().trim().min(1).max(120),
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
  employeeId: z.string().uuid().nullish(),
});

const teamResetSchema = z.object({
  membershipId: z.string().uuid(),
  password: z.string().min(1).max(200),
});

/**
 * A reception or finance login of the caller's account — never an owner's or a
 * master's, whatever id the request carries.
 */
async function findTeamLogin(
  accountId: string,
  membershipId: string,
): Promise<{ id: string; userId: string; role: TeamRole } | null> {
  if (!z.string().uuid().safeParse(membershipId).success) return null;
  const login = await prisma.membership.findFirst({
    where: { id: membershipId, accountId, role: { in: [...TEAM_ROLES] } },
    select: { id: true, userId: true, role: true },
  });
  const role = login ? appRoleOf(login.role) : null;
  return login && role && isTeamRole(role) ? { id: login.id, userId: login.userId, role } : null;
}

export async function createTeamLogin(input: unknown): Promise<ActionResult> {
  const session = await requirePermission("roles.assign");
  const t = await getTranslations("Workers.errors");
  const tt = await getTranslations("Workers.team");
  const parsed = teamCreateSchema.safeParse(input);
  if (!parsed.success) {
    const badEmail = parsed.error.issues.some((issue) => issue.path[0] === "email");
    return { ok: false, error: badEmail ? t("accessEmailInvalid") : t("invalidData") };
  }
  const d = parsed.data;
  // roles.assign is on every paid plan; a finance login additionally needs Pro.
  if (!canAssignRole(session, d.role)) return { ok: false, error: tt(PLAN_REQUIRED[d.role]) };

  const issues = passwordIssues(d.password);
  if (issues.length > 0) {
    const tp = await getTranslations("Auth.passwordIssues");
    return { ok: false, error: issues.map((c) => tp(c)).join(" ") };
  }

  const accountId = session.accountId!;
  try {
    const passwordHash = await hashPassword(d.password);

    await prisma.$transaction(async (tx) => {
      if (d.employeeId) {
        // Any branch of this account; one login per employee (the column is unique).
        const employee = await tx.employee.findFirst({
          where: { id: d.employeeId, salon: { accountId } },
          select: { membership: { select: { id: true } } },
        });
        if (!employee) throw new Error(tt("errors.employeeNotFound"));
        if (employee.membership) throw new Error(tt("errors.employeeTaken"));
      }

      const taken = await tx.user.findUnique({ where: { email: d.email }, select: { id: true } });
      if (taken) throw new Error(t("accessEmailTaken"));

      const user = await tx.user.create({
        data: { email: d.email, fullName: d.fullName, passwordHash },
        select: { id: true },
      });
      await tx.membership.create({
        data: {
          userId: user.id,
          accountId,
          role: d.role,
          // Reception works at the branch the owner is on; finance has no home
          // branch and starts at the account's primary one (see buildSession).
          salonId: spansAllBranches(d.role) ? null : session.salonId,
          employeeId: d.employeeId ?? null,
        },
      });
    });
  } catch (e) {
    // A concurrent create loses a unique index rather than the reads above.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const onEmployee = JSON.stringify(e.meta?.target ?? "").includes("employeeId");
      return { ok: false, error: onEmployee ? tt("errors.employeeTaken") : t("accessEmailTaken") };
    }
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function resetTeamLoginPassword(input: unknown): Promise<ActionResult> {
  const session = await requirePermission("roles.assign");
  const t = await getTranslations("Workers.errors");
  const tt = await getTranslations("Workers.team");
  const parsed = teamResetSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  const login = await findTeamLogin(session.accountId!, parsed.data.membershipId);
  if (!login) return { ok: false, error: tt("errors.notFound") };
  if (!canAssignRole(session, login.role)) {
    return { ok: false, error: tt(PLAN_REQUIRED[login.role]) };
  }

  const issues = passwordIssues(parsed.data.password);
  if (issues.length > 0) {
    const tp = await getTranslations("Auth.passwordIssues");
    return { ok: false, error: issues.map((c) => tp(c)).join(" ") };
  }

  const passwordHash = await hashPassword(parsed.data.password);
  // Ends the old sessions too, for the same reason as resetStaffPassword.
  await prisma.user.update({
    where: { id: login.userId },
    data: { passwordHash, sessionsValidFrom: new Date() },
  });

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function setTeamLoginActive(
  membershipId: string,
  active: boolean,
): Promise<ActionResult> {
  const session = await requirePermission("staff.manage");
  const tt = await getTranslations("Workers.team");
  const login = await findTeamLogin(session.accountId!, membershipId);
  if (!login) return { ok: false, error: tt("errors.notFound") };
  // Switching one back on hands access out again, so it needs what creating one
  // needs. Switching off never does.
  if (active === true && !canAssignRole(session, login.role)) {
    return { ok: false, error: tt(PLAN_REQUIRED[login.role]) };
  }

  await prisma.$transaction(async (tx) => {
    await tx.membership.update({
      where: { id: login.id },
      data: { disabledAt: active === true ? null : new Date() },
    });
    // getSession closes the login on its next request; the devices would keep
    // receiving the salon's notifications without this.
    if (active !== true) await dropStaffDevices(tx, login.userId);
  });

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

export async function revokeTeamLogin(membershipId: string): Promise<ActionResult> {
  const session = await requirePermission("staff.manage");
  const t = await getTranslations("Workers.errors");
  const tt = await getTranslations("Workers.team");
  const login = await findTeamLogin(session.accountId!, membershipId);
  if (!login) return { ok: false, error: tt("errors.notFound") };

  try {
    await prisma.$transaction((tx) => dropLogin(tx, login));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("saveFailed") };
  }

  revalidatePath("/dashboard/workers");
  return { ok: true };
}

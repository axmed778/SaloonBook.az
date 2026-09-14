"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requirePermission, type SalonSession } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

// Server actions for the Settings (Tənzimləmələr) screen. Every one needs
// settings.write. Each derives the caller's salon from the session and only ever
// writes to that salon (or, for branch management, to salons of the caller's own
// account).

export type ActionResult = { ok: true } | { ok: false; error: string };


/** Branch management additionally needs the account, not just the salon. */
async function requireBranchManager(): Promise<SalonSession & { accountId: string }> {
  const session = await requirePermission("settings.write");
  if (!session.accountId) throw new Error("Unauthorized: owner account required");
  return { ...session, accountId: session.accountId };
}

// --- Profile ---------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(2, "Salon adı ən az 2 simvol olmalıdır.").max(120),
  description: z.string().trim().max(1000).nullish(),
  address: z.string().trim().max(300).nullish(),
  // Coarse locality (rayon/district) — labels the salon on the discovery map.
  district: z.string().trim().max(120).nullish(),
  phone: z.string().trim().max(32).nullish(),
});

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const { salonId } = await requirePermission("settings.write");
  const t = await getTranslations("Settings.errors");
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const d = parsed.data;
  await prisma.salon.update({
    where: { id: salonId },
    data: {
      name: d.name,
      description: d.description || null,
      address: d.address || null,
      district: d.district || null,
      phone: d.phone || null,
    },
  });
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Map location (pin) ----------------------------------------------------

// Latitude/longitude for the public discovery map. Both null clears the pin
// (salon drops off the map). Sent together — a lone coordinate is meaningless.
const locationSchema = z
  .object({
    lat: z.number().min(-90).max(90).nullable(),
    lng: z.number().min(-180).max(180).nullable(),
  })
  .refine((d) => (d.lat === null) === (d.lng === null), {
    message: "Koordinatlar birlikdə göndərilməlidir.",
  });

export async function updateLocation(input: unknown): Promise<ActionResult> {
  const { salonId } = await requirePermission("settings.write");
  const t = await getTranslations("Settings.errors");
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidLocation") };
  }
  await prisma.salon.update({
    where: { id: salonId },
    data: { latitude: parsed.data.lat, longitude: parsed.data.lng },
  });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

// --- Booking link (slug) ---------------------------------------------------

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const slugSchema = z.object({ slug: z.string().trim().min(1).max(60) });

/**
 * The salon whose slug is the account's ADVERTISED booking link: the oldest
 * non-deleted one (created at registration). With multi-branch, every branch
 * keeps an internal slug, but this one is the single public link — the booking
 * page offers a branch picker on it.
 */
async function primarySalonOf(accountId: string): Promise<{ id: string; slug: string } | null> {
  return prisma.salon.findFirst({
    where: { accountId, status: { not: "DELETED" } },
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true },
  });
}

export async function updateSlug(input: unknown): Promise<ActionResult> {
  // settings.write, like every other card on this screen. This action used to
  // read the raw session with no role check at all, so a master's login could
  // rename the salon's public booking link by posting it directly.
  const session = await requirePermission("settings.write");
  const t = await getTranslations("Settings.errors");
  const parsed = slugSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidLink") };

  const slug = slugify(parsed.data.slug);
  if (slug.length < 2) {
    return { ok: false, error: t("slugTooShort") };
  }

  // The link card edits the account's PUBLIC link — the primary salon's slug —
  // regardless of which branch the dashboard is currently switched to.
  const target = session.accountId
    ? ((await primarySalonOf(session.accountId)) ?? { id: session.salonId })
    : { id: session.salonId };

  const existing = await prisma.salon.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== target.id) {
    return { ok: false, error: t("slugTaken") };
  }

  await prisma.salon.update({ where: { id: target.id }, data: { slug } });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

// --- Business hours --------------------------------------------------------

const hourSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    openMin: z.number().int().min(0).max(1440),
    closeMin: z.number().int().min(0).max(1440),
  })
  .refine((h) => h.closeMin > h.openMin, {
    message: "Bağlanma vaxtı açılışdan sonra olmalıdır.",
  });

const businessHoursSchema = z
  .array(hourSchema)
  .max(7)
  .superRefine((arr, ctx) => {
    const seen = new Set<number>();
    for (const h of arr) {
      if (seen.has(h.weekday)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Hər gün üçün yalnız bir interval.",
        });
        return;
      }
      seen.add(h.weekday);
    }
  });

export async function updateBusinessHours(input: unknown): Promise<ActionResult> {
  const { salonId } = await requirePermission("settings.write");
  const t = await getTranslations("Settings.errors");
  const parsed = businessHoursSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidHours") };
  }
  await prisma.salon.update({
    where: { id: salonId },
    data: { businessHours: parsed.data },
  });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

// --- Branches (filiallar) ----------------------------------------------------
//
// Multi-branch is a Pro feature. Every branch is a Salon row under the same
// Account; the account keeps ONE public booking link (the primary salon's slug)
// and clients pick the branch in a dropdown on the booking page. Each branch
// still needs a unique internal slug — auto-generated here, never advertised.

/** Returns a slug not already taken, appending -2, -3, ... if needed. */
async function uniqueBranchSlug(base: string): Promise<string> {
  const root = base || "filial";
  let candidate = root;
  let n = 1;
  // Bounded loop; collisions are rare.
  while (await prisma.salon.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    n += 1;
    candidate = `${root}-${n}`;
  }
  return candidate;
}

const branchCreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).nullish(),
});

export async function createBranch(input: unknown): Promise<ActionResult> {
  const session = await requireBranchManager();
  const t = await getTranslations("Settings.branches.errors");

  const parsed = branchCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  if (!session.multiBranch) return { ok: false, error: t("proRequired") };

  const { name, address } = parsed.data;
  const { accountId, maxBranches } = session;
  const slug = await uniqueBranchSlug(slugify(name));

  // Plan cap: Pro includes 3 branches; paid extra slots (granted by a platform
  // admin, 15 ₼ each) raise it. session.maxBranches is base + extras.
  //
  // Counted and created in one transaction that locks the account row first, so
  // two requests at the same moment cannot both see a free slot — before this,
  // the count and the insert were not even in the same transaction. NO KEY UPDATE
  // conflicts with itself but not with the KEY SHARE lock an insert referencing
  // the account takes.
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM "Account" WHERE "id" = ${accountId} FOR NO KEY UPDATE`;
    const count = await tx.salon.count({
      where: { accountId, status: { not: "DELETED" } },
    });
    if (count >= maxBranches) return false;

    // New branches inherit audience/timezone/currency from the primary salon so
    // the booking flow behaves consistently; the owner renames freely.
    const template = await tx.salon.findFirst({
      where: { accountId, status: { not: "DELETED" } },
      orderBy: { createdAt: "asc" },
      select: { audience: true, timezone: true, currency: true },
    });
    await tx.salon.create({
      data: {
        accountId,
        slug,
        name,
        address: address || null,
        audience: template?.audience ?? "ALL",
        timezone: template?.timezone ?? "Asia/Baku",
        currency: template?.currency ?? "AZN",
      },
    });
    return true;
  });
  if (!created) return { ok: false, error: t("limitReached") };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

const branchUpdateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(300).nullish(),
});

export async function updateBranch(input: unknown): Promise<ActionResult> {
  const session = await requireBranchManager();
  const t = await getTranslations("Settings.branches.errors");

  const parsed = branchUpdateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  // accountId in the filter is the tenant guard.
  const res = await prisma.salon.updateMany({
    where: { id: d.id, accountId: session.accountId!, status: { not: "DELETED" } },
    data: { name: d.name, address: d.address || null },
  });
  if (res.count === 0) return { ok: false, error: t("notFound") };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

const branchStatusSchema = z.object({
  id: z.string().uuid(),
  active: z.boolean(),
});

export async function setBranchStatus(input: unknown): Promise<ActionResult> {
  const session = await requireBranchManager();
  const t = await getTranslations("Settings.branches.errors");

  const parsed = branchStatusSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  if (!d.active) {
    // The primary branch carries the public booking link and is the fallback
    // scope for the whole dashboard — it can't be turned off.
    const primary = await primarySalonOf(session.accountId!);
    if (primary?.id === d.id) return { ok: false, error: t("primaryLocked") };
  }

  const res = await prisma.salon.updateMany({
    where: {
      id: d.id,
      accountId: session.accountId!,
      status: d.active ? "SUSPENDED" : "ACTIVE",
    },
    data: { status: d.active ? "ACTIVE" : "SUSPENDED" },
  });
  if (res.count === 0) return { ok: false, error: t("notFound") };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

const branchDeleteSchema = z.object({ id: z.string().uuid() });

/**
 * Hard-deletes a branch and its catalog (employees, services, schedules, staff
 * logins). Only for branches with NO booking/client history — those are
 * business records, so the action refuses and points to deactivation instead
 * (same rule as deleting a service with appointments). The primary branch
 * carries the public link and can never be deleted. Works on any plan, so a
 * downgraded account can still clean up leftover branches.
 */
export async function deleteBranch(input: unknown): Promise<ActionResult> {
  const session = await requireBranchManager();
  const t = await getTranslations("Settings.branches.errors");

  const parsed = branchDeleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { id } = parsed.data;

  // accountId is the tenant guard.
  const branch = await prisma.salon.findFirst({
    where: { id, accountId: session.accountId! },
    select: { id: true, name: true, slug: true },
  });
  if (!branch) return { ok: false, error: t("notFound") };

  const primary = await primarySalonOf(session.accountId!);
  if (primary?.id === id) return { ok: false, error: t("primaryDelete") };

  const [appointments, customers] = await Promise.all([
    prisma.appointment.count({ where: { salonId: id } }),
    prisma.customer.count({ where: { salonId: id } }),
  ]);
  if (appointments > 0 || customers > 0) return { ok: false, error: t("hasData") };

  // The branch's masters lose their logins with it. Collect the user rows behind
  // those memberships too: dropping only the membership would leave a working
  // password attached to nothing, and an email address permanently spent. A user
  // who somehow also belongs to another salon is left alone — this action was
  // not asked to touch that one.
  const staffUserIds = (
    await prisma.membership.findMany({
      where: { salonId: id, role: "STAFF" },
      select: { userId: true },
    })
  ).map((m) => m.userId);
  const elsewhere = new Set(
    (
      await prisma.membership.findMany({
        where: { userId: { in: staffUserIds }, NOT: { salonId: id, role: "STAFF" } },
        select: { userId: true },
      })
    ).map((m) => m.userId),
  );
  const orphanedUserIds = staffUserIds.filter((uid) => !elsewhere.has(uid));

  try {
    await prisma.$transaction([
      // Belt-and-braces: with zero appointments/customers these are empty, but
      // sweeping them keeps the salon delete below FK-safe no matter what.
      prisma.notification.deleteMany({ where: { salonId: id } }),
      // Push subscriptions are keyed by salon and have no FK to cascade through;
      // left behind they would point at a branch that no longer exists.
      prisma.pushSubscription.deleteMany({ where: { salonId: id } }),
      prisma.customerNote.deleteMany({ where: { salonId: id } }),
      prisma.payout.deleteMany({ where: { salonId: id } }),
      prisma.usageCounter.deleteMany({ where: { salonId: id } }),
      // Branch-bound STAFF logins go with the branch; the OWNER membership
      // always points at the primary, which is never deletable.
      prisma.membership.deleteMany({ where: { salonId: id, role: "STAFF" } }),
      prisma.passwordResetToken.deleteMany({ where: { userId: { in: orphanedUserIds } } }),
      prisma.user.deleteMany({ where: { id: { in: orphanedUserIds } } }),
      // WorkingHour/TimeOff/ServiceEmployee cascade from employees/services.
      prisma.employee.deleteMany({ where: { salonId: id } }),
      prisma.service.deleteMany({ where: { salonId: id } }),
      prisma.salon.delete({ where: { id } }),
      prisma.auditLog.create({
        data: {
          accountId: session.accountId!,
          actorUserId: session.user.id,
          action: "salon.delete",
          target: id,
          meta: { name: branch.name, slug: branch.slug },
        },
      }),
    ]);
  } catch (e) {
    // A booking racing in between the count check and the delete trips the FK
    // restraint and rolls the whole transaction back — surface it as "has data".
    console.error("[settings] deleteBranch failed", e);
    return { ok: false, error: t("hasData") };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

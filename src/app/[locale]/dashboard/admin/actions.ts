"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { intlLocale } from "@/i18n/format";
import { PLAN_LIMITS, EXTRA_BRANCH_PRICE_MINOR, featuresFor, limitsFor } from "@/lib/plans";
import { addMonths, bakuToday, bakuYmd, formatBakuDate } from "@/lib/time";
import { effectivePlan, subscriptionWindow } from "@/lib/subscription";
import { encryptSecret, hasEncryptionKey } from "@/lib/crypto";
import { fetchWhatsAppNumberInfo } from "@/lib/whatsapp";

// Platform-admin actions: manual billing (mark a salon as paid). Guarded by
// isPlatformAdmin — regular owners can never reach these. Every activation
// writes a Payment row and an AuditLog entry with the acting admin.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireAdmin(): Promise<string> {
  const session = await getSession();
  if (!session?.isAdmin) throw new Error("Unauthorized: admin only");
  return session.user.id;
}

const activateSchema = z.object({
  accountId: z.string().uuid(),
  plan: z.enum(["START", "BASIC", "PRO"]),
  months: z.number().int().min(1).max(24),
  /** Payment received, in qəpik. Defaults to list price × months. */
  amountMinor: z.number().int().min(0).max(10_000_000).nullish(),
});

export async function activateSubscription(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("Admin.errors");
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return { ok: false, error: t("unauthorized") };
  }
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const sub = await prisma.subscription.findUnique({
    where: { accountId: d.accountId },
    select: { id: true, plan: true, status: true, currentPeriodEnd: true },
  });
  if (!sub) return { ok: false, error: t("subNotFound") };

  // Early renewal keeps the remaining days: extend from the current period end
  // when it's still in the future, otherwise start the period today.
  const now = new Date();
  const base =
    sub.status === "ACTIVE" && sub.currentPeriodEnd && sub.currentPeriodEnd > now
      ? sub.currentPeriodEnd
      : now;
  const periodEnd = addMonths(base, d.months);

  const amountMinor = d.amountMinor ?? PLAN_LIMITS[d.plan].priceMinor * d.months;

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: sub.id },
      data: { plan: d.plan, status: "ACTIVE", currentPeriodEnd: periodEnd },
    }),
    prisma.payment.create({
      data: {
        subscriptionId: sub.id,
        amountMinor,
        method: "manual",
        periodMonths: d.months,
        recordedBy: adminId,
      },
    }),
    prisma.auditLog.create({
      data: {
        accountId: d.accountId,
        actorUserId: adminId,
        action: "subscription.activate",
        target: sub.id,
        meta: {
          plan: d.plan,
          months: d.months,
          amountMinor,
          previousStatus: sub.status,
          previousPlan: sub.plan,
          currentPeriodEnd: periodEnd.toISOString(),
        },
      },
    }),
  ]);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// --- Per-salon WhatsApp sender ("own number", Pro) ---------------------------
// Store a salon's own Meta WhatsApp credentials, validate them against Meta, and
// flip the sender to ACTIVE (so resolveWhatsAppSender routes this salon's sends
// through its number). The access token is encrypted at rest and NEVER written
// to the AuditLog. This is the "one button" that makes a salon independent of the
// shared platform number — see docs/own-number.md.

const setSenderSchema = z.object({
  salonId: z.string().uuid(),
  phoneNumberId: z.string().trim().min(1).max(64),
  accessToken: z.string().trim().min(1).max(2048),
  wabaId: z.string().trim().max(64).nullish(),
});

export async function setWhatsAppSender(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("Admin.errors");
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return { ok: false, error: t("unauthorized") };
  }
  if (!hasEncryptionKey()) return { ok: false, error: t("encKeyMissing") };

  const parsed = setSenderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const salon = await prisma.salon.findUnique({
    where: { id: d.salonId },
    select: { id: true, accountId: true },
  });
  if (!salon) return { ok: false, error: t("salonNotFound") };

  // Validate the credentials against Meta before activating. Success proves the
  // token can act on this phone_number_id → ACTIVE; failure stores the creds but
  // leaves the sender PENDING with the error, so the admin can fix and retry.
  let verifiedName: string | null = null;
  let displayPhone: string | null = null;
  let status: "ACTIVE" | "PENDING" = "ACTIVE";
  let lastError: string | null = null;
  try {
    const info = await fetchWhatsAppNumberInfo(d.accessToken, d.phoneNumberId);
    verifiedName = info.verifiedName ?? null;
    displayPhone = info.displayPhone ?? null;
  } catch (e) {
    status = "PENDING";
    lastError = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
  }

  const accessTokenEnc = encryptSecret(d.accessToken);

  const senderData = {
    status,
    phoneNumberId: d.phoneNumberId,
    wabaId: d.wabaId ?? null,
    accessTokenEnc,
    displayPhone,
    verifiedName,
    lastError,
  };

  await prisma.$transaction([
    prisma.whatsAppSender.upsert({
      where: { salonId: d.salonId },
      create: { salonId: d.salonId, ...senderData },
      update: senderData,
    }),
    prisma.auditLog.create({
      data: {
        accountId: salon.accountId,
        actorUserId: adminId,
        action: "whatsapp.sender.set",
        target: d.salonId,
        // Never log the token; ids/status only.
        meta: {
          phoneNumberId: d.phoneNumberId,
          wabaId: d.wabaId ?? null,
          status,
          verifiedName,
          ...(lastError ? { lastError } : {}),
        },
      },
    }),
  ]);

  revalidatePath("/dashboard/admin");
  return status === "ACTIVE" ? { ok: true } : { ok: false, error: t("senderPending") };
}

const disableSenderSchema = z.object({ salonId: z.string().uuid() });

/** Turn a salon's own number OFF — reverts it to the shared platform number. */
export async function disableWhatsAppSender(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("Admin.errors");
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return { ok: false, error: t("unauthorized") };
  }
  const parsed = disableSenderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const sender = await prisma.whatsAppSender.findUnique({
    where: { salonId: d.salonId },
    select: { salonId: true, salon: { select: { accountId: true } } },
  });
  if (!sender) return { ok: false, error: t("senderNotFound") };

  await prisma.$transaction([
    prisma.whatsAppSender.update({
      where: { salonId: d.salonId },
      data: { status: "DISABLED" },
    }),
    prisma.auditLog.create({
      data: {
        accountId: sender.salon.accountId,
        actorUserId: adminId,
        action: "whatsapp.sender.disable",
        target: d.salonId,
      },
    }),
  ]);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// --- Paid extra branch slots -------------------------------------------------

const extraBranchesSchema = z.object({
  accountId: z.string().uuid(),
  /** New TOTAL of extra slots on top of the plan's maxBranches. */
  extraBranches: z.number().int().min(0).max(50),
  /** Payment received, in qəpik. Defaults to added slots × list price. */
  amountMinor: z.number().int().min(0).max(10_000_000).nullish(),
});

/**
 * Sets an account's paid extra branch slots (each EXTRA_BRANCH_PRICE_MINOR,
 * collected manually like every payment here). When the total goes UP, a
 * Payment row is recorded for the added slots (amount overridable, e.g. for a
 * discount); lowering the total just revokes slots — already-created branches
 * are never touched, the owner simply can't add new ones past the new limit.
 */
export async function setExtraBranches(input: unknown): Promise<ActionResult> {
  const t = await getTranslations("Admin.errors");
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return { ok: false, error: t("unauthorized") };
  }
  const parsed = extraBranchesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const sub = await prisma.subscription.findUnique({
    where: { accountId: d.accountId },
    select: { id: true, extraBranches: true },
  });
  if (!sub) return { ok: false, error: t("subNotFound") };

  const added = d.extraBranches - sub.extraBranches;
  const amountMinor = d.amountMinor ?? Math.max(0, added) * EXTRA_BRANCH_PRICE_MINOR;

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: sub.id },
      data: { extraBranches: d.extraBranches },
    }),
    ...(added > 0
      ? [
          prisma.payment.create({
            data: {
              subscriptionId: sub.id,
              amountMinor,
              method: "manual",
              periodMonths: 1,
              recordedBy: adminId,
            },
          }),
        ]
      : []),
    prisma.auditLog.create({
      data: {
        accountId: d.accountId,
        actorUserId: adminId,
        action: "subscription.extra_branches",
        target: sub.id,
        meta: {
          previous: sub.extraBranches,
          next: d.extraBranches,
          amountMinor: added > 0 ? amountMinor : 0,
        },
      },
    }),
  ]);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// --- Salon card (read-only) --------------------------------------------------
// Everything an admin asks about a salon on the phone — when the subscription
// started, how many days are left, how many staff, which address, who to call —
// in one payload. Loaded on demand rather than folded into the table query:
// the list renders every account, and pulling each one's branches and staff
// eagerly would make the page pay for a modal most rows never open.

export type AdminSalonDetails = {
  account: {
    name: string;
    status: string;
    createdLabel: string;
    legalAcceptedLabel: string | null;
    marketingOptIn: boolean;
  };
  subscription: {
    plan: string;
    /** What the account is entitled to right now (may differ from `plan`). */
    effective: string;
    status: string | null;
    /** When the subscription row was created — i.e. when the account signed up. */
    startedLabel: string | null;
    /** Start of the period currently paid for = the last payment's date. */
    periodStartLabel: string | null;
    basis: "trial" | "period" | "open" | "none";
    endsLabel: string | null;
    daysLeft: number | null;
    inGrace: boolean;
    graceDaysLeft: number;
    extraBranches: number;
    branchCount: number;
    branchLimit: number;
    paymentsCount: number;
    totalPaidMinor: number;
  };
  owners: { email: string; name: string | null; phone: string | null }[];
  branches: {
    id: string;
    name: string;
    slug: string;
    status: string;
    audience: string;
    address: string | null;
    district: string | null;
    phone: string | null;
    /** Map link for the owner-dropped pin; null until they place one. */
    mapUrl: string | null;
    createdLabel: string;
    bookingsThisMonth: number;
    employees: {
      id: string;
      name: string;
      position: string | null;
      phone: string | null;
      isActive: boolean;
    }[];
  }[];
  employeesTotal: number;
  employeesActive: number;
};

export type DetailsResult =
  | { ok: true; details: AdminSalonDetails }
  | { ok: false; error: string };

const detailsSchema = z.object({ accountId: z.string().uuid() });

export async function getAccountDetails(input: unknown): Promise<DetailsResult> {
  const t = await getTranslations("Admin.errors");
  try {
    await requireAdmin();
  } catch {
    return { ok: false, error: t("unauthorized") };
  }
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  const account = await prisma.account.findUnique({
    where: { id: parsed.data.accountId },
    select: {
      name: true,
      status: true,
      createdAt: true,
      legalAcceptedAt: true,
      marketingOptIn: true,
      subscription: {
        select: {
          plan: true,
          status: true,
          trialEndsAt: true,
          currentPeriodEnd: true,
          extraBranches: true,
          createdAt: true,
          _count: { select: { payments: true } },
          payments: { orderBy: { paidAt: "desc" }, take: 1, select: { paidAt: true } },
        },
      },
      memberships: {
        where: { role: "OWNER" },
        select: { user: { select: { email: true, fullName: true, phone: true } } },
      },
      salons: {
        where: { status: { not: "DELETED" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          audience: true,
          address: true,
          district: true,
          phone: true,
          latitude: true,
          longitude: true,
          createdAt: true,
          employees: {
            orderBy: [{ isActive: "desc" }, { name: "asc" }],
            select: { id: true, name: true, position: true, phone: true, isActive: true },
          },
        },
      },
    },
  });
  if (!account) return { ok: false, error: t("accountNotFound") };

  const df = intlLocale(await getLocale());
  const day = (d: Date) => formatBakuDate(bakuYmd(d), df);
  const sub = account.subscription;
  const effective = effectivePlan(sub ?? null);
  const window = subscriptionWindow(sub ?? null);

  // Per-branch usage for the current month, in one query rather than N.
  const salonIds = account.salons.map((s) => s.id);
  const [usage, paid] = await Promise.all([
    salonIds.length
      ? prisma.usageCounter.findMany({
          where: { periodYm: bakuToday().slice(0, 7), salonId: { in: salonIds } },
          select: { salonId: true, bookings: true },
        })
      : Promise.resolve([]),
    sub
      ? prisma.payment.aggregate({
          where: { subscription: { accountId: parsed.data.accountId } },
          _sum: { amountMinor: true },
        })
      : Promise.resolve(null),
  ]);
  const bookingsBySalon = new Map(usage.map((u) => [u.salonId, u.bookings]));

  const employeesTotal = account.salons.reduce((n, s) => n + s.employees.length, 0);
  const employeesActive = account.salons.reduce(
    (n, s) => n + s.employees.filter((e) => e.isActive).length,
    0,
  );

  return {
    ok: true,
    details: {
      account: {
        name: account.name,
        status: account.status,
        createdLabel: day(account.createdAt),
        legalAcceptedLabel: account.legalAcceptedAt ? day(account.legalAcceptedAt) : null,
        marketingOptIn: account.marketingOptIn,
      },
      subscription: {
        plan: sub?.plan ?? "FREE",
        effective,
        status: sub?.status ?? null,
        startedLabel: sub ? day(sub.createdAt) : null,
        periodStartLabel: sub?.payments[0] ? day(sub.payments[0].paidAt) : null,
        basis: window.basis,
        endsLabel: window.endsAt ? day(window.endsAt) : null,
        daysLeft: window.daysLeft,
        inGrace: window.inGrace,
        graceDaysLeft: window.graceDaysLeft,
        extraBranches: sub?.extraBranches ?? 0,
        branchCount: account.salons.length,
        // Same rule as the session and the table: extras only count while the
        // effective plan actually has multi-branch.
        branchLimit:
          limitsFor(effective).maxBranches +
          (featuresFor(effective).multiBranch ? (sub?.extraBranches ?? 0) : 0),
        paymentsCount: sub?._count.payments ?? 0,
        totalPaidMinor: paid?._sum.amountMinor ?? 0,
      },
      owners: account.memberships.map((m) => ({
        email: m.user.email,
        name: m.user.fullName,
        phone: m.user.phone,
      })),
      branches: account.salons.map((s) => ({
        id: s.id,
        name: s.name,
        slug: s.slug,
        status: s.status,
        audience: s.audience,
        address: s.address,
        district: s.district,
        phone: s.phone,
        mapUrl:
          s.latitude != null && s.longitude != null
            ? `https://www.google.com/maps?q=${s.latitude},${s.longitude}`
            : null,
        createdLabel: day(s.createdAt),
        bookingsThisMonth: bookingsBySalon.get(s.id) ?? 0,
        employees: s.employees,
      })),
      employeesTotal,
      employeesActive,
    },
  };
}

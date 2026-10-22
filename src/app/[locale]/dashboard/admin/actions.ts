"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { intlLocale } from "@/i18n/format";
import { PLAN_LIMITS, EXTRA_BRANCH_PRICE_MINOR, featuresFor, limitsFor } from "@/lib/plans";
import { addDays, addMonths, bakuToday, bakuYmd, formatBakuDate } from "@/lib/time";
import { effectivePlan, subscriptionWindow } from "@/lib/subscription";
import { encryptSecret, hasEncryptionKey } from "@/lib/crypto";
import { fetchWhatsAppNumberInfo } from "@/lib/whatsapp";
import { verifyPassword } from "@/lib/auth/password";
import { rateLimit } from "@/lib/ratelimit";
import { agentRewardDue, normalizeAgentCode } from "@/lib/referral";
import {
  deleteAccountCompletely,
  planAccountDeletion,
  type AccountDeletionPlan,
} from "@/lib/account-deletion";

// Platform-admin actions: manual billing (mark a salon as paid). Guarded by
// isPlatformAdmin — regular owners can never reach these. Every activation
// writes a Payment row and an AuditLog entry with the acting admin.

export type ActionResult = { ok: true } | { ok: false; error: string };

/** The acting platform admin's user id, or null for anyone else. */
async function requireAdmin(): Promise<string | null> {
  const session = await getSession();
  return session?.isAdmin ? session.user.id : null;
}

const activateSchema = z.object({
  accountId: z.string().uuid(),
  plan: z.enum(["START", "BASIC", "PRO"]),
  months: z.number().int().min(1).max(24),
  /** Payment received, in qəpik. Defaults to list price × months. */
  amountMinor: z.number().int().min(0).max(10_000_000).nullish(),
});

export async function activateSubscription(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
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

const trialSchema = z.object({
  accountId: z.string().uuid(),
  plan: z.enum(["START", "BASIC", "PRO"]),
  days: z.number().int().min(1).max(90),
});

/**
 * Grant a (repeat) free trial by hand: status → TRIALING with a fresh end date.
 * A trial that is still running is extended from its current end; otherwise the
 * new trial starts today. No Payment is written — a trial is free — but the
 * AuditLog keeps who granted it and what the account was on before.
 */
export async function grantTrial(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
  const parsed = trialSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const sub = await prisma.subscription.findUnique({
    where: { accountId: d.accountId },
    select: { id: true, plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
  });
  if (!sub) return { ok: false, error: t("subNotFound") };

  const now = new Date();
  // A trial would replace a paid period (effectivePlan only reads trialEndsAt
  // while TRIALING), cutting off access the salon paid for. Refuse instead.
  if (sub.status === "ACTIVE" && (!sub.currentPeriodEnd || sub.currentPeriodEnd > now)) {
    return { ok: false, error: t("trialWhilePaid") };
  }
  const base =
    sub.status === "TRIALING" && sub.trialEndsAt && sub.trialEndsAt > now ? sub.trialEndsAt : now;
  const trialEndsAt = addDays(base, d.days);

  await prisma.$transaction([
    prisma.subscription.update({
      where: { id: sub.id },
      data: { plan: d.plan, status: "TRIALING", trialEndsAt },
    }),
    prisma.auditLog.create({
      data: {
        accountId: d.accountId,
        actorUserId: adminId,
        action: "subscription.trial",
        target: sub.id,
        meta: {
          plan: d.plan,
          days: d.days,
          previousStatus: sub.status,
          previousPlan: sub.plan,
          trialEndsAt: trialEndsAt.toISOString(),
        },
      },
    }),
  ]);

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

const deletePaymentSchema = z.object({
  paymentId: z.string().uuid(),
  /** Also take the payment's months back off the paid period. */
  shortenPeriod: z.boolean(),
});

/**
 * Remove a payment recorded by mistake. By default only the Payment row goes
 * (revenue and history are corrected, access is untouched). With
 * `shortenPeriod` the paid period is pulled back by the payment's months; if
 * that leaves nothing in the future the account drops to FREE_DOWNGRADED.
 * The deleted row is kept in full in the AuditLog.
 */
export async function deletePayment(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
  const parsed = deletePaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const payment = await prisma.payment.findUnique({
    where: { id: d.paymentId },
    select: {
      id: true,
      amountMinor: true,
      periodMonths: true,
      purpose: true,
      method: true,
      paidAt: true,
      subscription: {
        select: { id: true, accountId: true, status: true, currentPeriodEnd: true },
      },
    },
  });
  if (!payment) return { ok: false, error: t("paymentNotFound") };
  const sub = payment.subscription;

  let subUpdate: { status?: "FREE_DOWNGRADED"; currentPeriodEnd: Date } | null = null;
  // Branch-slot payments never extended the period, so there is nothing to undo.
  if (d.shortenPeriod && payment.purpose !== "plan") {
    return { ok: false, error: t("invalidData") };
  }
  if (d.shortenPeriod && sub.currentPeriodEnd) {
    const newEnd = addMonths(sub.currentPeriodEnd, -payment.periodMonths);
    subUpdate =
      newEnd > new Date()
        ? { currentPeriodEnd: newEnd }
        : { currentPeriodEnd: newEnd, status: "FREE_DOWNGRADED" };
  }

  await prisma.$transaction([
    prisma.payment.delete({ where: { id: payment.id } }),
    ...(subUpdate
      ? [prisma.subscription.update({ where: { id: sub.id }, data: subUpdate })]
      : []),
    prisma.auditLog.create({
      data: {
        accountId: sub.accountId,
        actorUserId: adminId,
        action: "payment.delete",
        target: payment.id,
        meta: {
          amountMinor: payment.amountMinor,
          periodMonths: payment.periodMonths,
          method: payment.method,
          purpose: payment.purpose,
          paidAt: payment.paidAt.toISOString(),
          shortenPeriod: d.shortenPeriod,
          previousStatus: sub.status,
          previousPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          ...(subUpdate
            ? {
                currentPeriodEnd: subUpdate.currentPeriodEnd.toISOString(),
                status: subUpdate.status ?? sub.status,
              }
            : {}),
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
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
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
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
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
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
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
              purpose: "branches",
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
  owners: {
    email: string;
    name: string | null;
    phone: string | null;
    /** When this owner last signed in; null if they have not since it was tracked. */
    lastLoginLabel: string | null;
  }[];
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
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
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
        select: {
          user: { select: { email: true, fullName: true, phone: true, lastLoginAt: true } },
        },
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
        lastLoginLabel: m.user.lastLoginAt ? day(m.user.lastLoginAt) : null,
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

// --- Delete a salon account completely ---------------------------------------
// Irreversible: the account, every branch with its bookings/clients/payments,
// the subscription and the account's logins (see src/lib/account-deletion.ts).
// The admin re-enters THEIR OWN password — a session left open on someone
// else's screen must not be enough to wipe a salon.

export type AccountDeletionPreview = Omit<AccountDeletionPlan, "userIds" | "accountId">;
export type PreviewResult =
  | { ok: true; preview: AccountDeletionPreview }
  | { ok: false; error: string };

const accountIdSchema = z.object({ accountId: z.string().uuid() });

/** What "delete account" would remove, shown in the confirm dialog. */
export async function previewAccountDeletion(input: unknown): Promise<PreviewResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
  const parsed = accountIdSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  const plan = await planAccountDeletion(parsed.data.accountId);
  if (!plan) return { ok: false, error: t("accountNotFound") };
  const { userIds: _userIds, accountId: _accountId, ...preview } = plan;
  return { ok: true, preview };
}

const deleteAccountSchema = z.object({
  accountId: z.string().uuid(),
  password: z.string().min(1).max(256),
});

// Wrong-password tries per admin before the action locks for the window.
const DELETE_PW_LIMIT = { limit: 5, windowSec: 15 * 60 };

export async function deleteAccount(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
  const parsed = deleteAccountSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const rl = await rateLimit(
    `admin:delete-account:${adminId}`,
    DELETE_PW_LIMIT.limit,
    DELETE_PW_LIMIT.windowSec,
  );
  if (!rl.allowed) return { ok: false, error: t("tooManyAttempts") };

  const admin = await prisma.user.findUnique({
    where: { id: adminId },
    select: { passwordHash: true },
  });
  if (!(await verifyPassword(d.password, admin?.passwordHash))) {
    return { ok: false, error: t("wrongPassword") };
  }

  // Re-planned inside the delete rather than trusting the preview the dialog
  // showed: a login or branch added since then must go too.
  try {
    const deleted = await deleteAccountCompletely(d.accountId, {
      actorUserId: adminId,
      via: "admin",
    });
    if (!deleted) return { ok: false, error: t("accountNotFound") };
  } catch (e) {
    console.error("[admin] deleteAccount failed", e);
    return { ok: false, error: t("deleteFailed") };
  }

  revalidatePath("/dashboard/admin");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Sales agents (referral codes). An agent earns a one-off reward per salon
// that pays (src/lib/referral.ts); the admin pays it by hand and marks it here.
// ---------------------------------------------------------------------------

const agentSchema = z.object({
  name: z.string().trim().min(1).max(80),
  code: z.string().max(40),
  phone: z.string().trim().max(40).optional(),
});

export async function createAgent(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin");
  if (!adminId) return { ok: false, error: t("errors.unauthorized") };
  const parsed = agentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidData") };
  const code = normalizeAgentCode(parsed.data.code);
  if (!code) return { ok: false, error: t("agents.errCode") };
  const taken = await prisma.agent.findUnique({ where: { code }, select: { id: true } });
  if (taken) return { ok: false, error: t("agents.errCodeTaken") };

  const agent = await prisma.agent.create({
    data: { code, name: parsed.data.name, phone: parsed.data.phone || null },
  });
  await prisma.auditLog.create({
    data: {
      actorUserId: adminId,
      action: "agent.create",
      target: agent.id,
      meta: { code, name: agent.name },
    },
  });
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

const assignSchema = z.object({
  accountId: z.string().uuid(),
  agentId: z.string().uuid().nullable(),
});

/** Link a salon to an agent by hand (forgot the code at signup), or unlink it. */
export async function setAccountAgent(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { accountId, agentId } = parsed.data;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: { agentId: true, agentRewardPaidAt: true },
  });
  if (!account) return { ok: false, error: t("accountNotFound") };
  // A paid-out reward belongs to the agent it was paid to: moving the salon
  // would show that payout under the new agent. Undo the payout first.
  if (account.agentRewardPaidAt && account.agentId !== agentId) {
    return { ok: false, error: (await getTranslations("Admin.agents"))("errReassignPaid") };
  }

  await prisma.$transaction([
    prisma.account.update({ where: { id: accountId }, data: { agentId } }),
    prisma.auditLog.create({
      data: {
        accountId,
        actorUserId: adminId,
        action: "agent.assign",
        target: accountId,
        meta: { from: account.agentId, to: agentId },
      },
    }),
  ]);
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

const rewardSchema = z.object({
  accountId: z.string().uuid(),
  paid: z.boolean(),
});

/**
 * Mark the agent's reward for one salon as paid out (freezing the amount owed
 * right now), or undo that mark. Refuses while the salon hasn't paid.
 */
export async function setAgentRewardPaid(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("Admin");
  if (!adminId) return { ok: false, error: t("errors.unauthorized") };
  const parsed = rewardSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("errors.invalidData") };
  const { accountId, paid } = parsed.data;

  const account = await prisma.account.findUnique({
    where: { id: accountId },
    select: {
      agentId: true,
      // Only plan payments count: a branch-slot charge during a trial is not
      // the salon paying for SalonBook.
      subscription: {
        select: {
          plan: true,
          payments: { where: { purpose: "plan" }, select: { amountMinor: true } },
        },
      },
    },
  });
  if (!account?.agentId) return { ok: false, error: t("errors.accountNotFound") };

  let rewardMinor: number | null = null;
  if (paid) {
    const sub = account.subscription;
    const paidMinor = (sub?.payments ?? []).reduce((sum, p) => sum + p.amountMinor, 0);
    rewardMinor = sub ? agentRewardDue({ plan: sub.plan, paidMinor }) : 0;
    if (rewardMinor <= 0) return { ok: false, error: t("agents.errNotPaid") };
  }

  await prisma.$transaction([
    prisma.account.update({
      where: { id: accountId },
      data: { agentRewardPaidAt: paid ? new Date() : null, agentRewardMinor: rewardMinor },
    }),
    prisma.auditLog.create({
      data: {
        accountId,
        actorUserId: adminId,
        action: paid ? "agent.reward.paid" : "agent.reward.undo",
        target: account.agentId,
        meta: { rewardMinor },
      },
    }),
  ]);
  revalidatePath("/dashboard/agents");
  return { ok: true };
}

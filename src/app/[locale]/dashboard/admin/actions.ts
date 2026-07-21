"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS, EXTRA_BRANCH_PRICE_MINOR } from "@/lib/plans";
import { addMonths } from "@/lib/time";
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
  plan: z.enum(["BASIC", "PRO"]),
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

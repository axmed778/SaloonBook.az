"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { PLAN_LIMITS } from "@/lib/plans";
import { addMonths } from "@/lib/time";

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
  let adminId: string;
  try {
    adminId = await requireAdmin();
  } catch {
    return { ok: false, error: "İcazə yoxdur." };
  }
  const parsed = activateSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Yanlış məlumat." };
  const d = parsed.data;

  const sub = await prisma.subscription.findUnique({
    where: { accountId: d.accountId },
    select: { id: true, plan: true, status: true, currentPeriodEnd: true },
  });
  if (!sub) return { ok: false, error: "Abunəlik tapılmadı." };

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

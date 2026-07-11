import type { Plan, Prisma, SubStatus } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { PLAN_LIMITS, type PlanLimits } from "./plans";

// Centralized subscription resolution. Every enforcement point (booking limit,
// employee seats, future branch limits) and any UI that gates features must go
// through effectivePlan()/effectiveLimits() instead of reading Subscription.plan
// directly: the raw row says what the account signed up for, these say what it
// is entitled to RIGHT NOW. Time-aware on purpose — an expired trial downgrades
// the moment it expires, even before the nightly worker sweep flips the status.

/**
 * Days an ACTIVE subscription keeps its plan after currentPeriodEnd. Payments
 * are manual (bank transfer / cash → owner activates by hand), so a hard cutoff
 * at midnight would punish on-time payers for the owner's activation lag.
 */
export const GRACE_DAYS = 3;

export interface SubscriptionLike {
  plan: Plan;
  status: SubStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

/** The plan an account is actually entitled to at `now`. */
export function effectivePlan(
  sub: SubscriptionLike | null | undefined,
  now: Date = new Date(),
): Plan {
  if (!sub) return "FREE";
  switch (sub.status) {
    case "TRIALING":
      // A trial without an end date grants nothing (legacy rows from before
      // trialEndsAt was set at registration are FREE-plan anyway).
      return sub.trialEndsAt && sub.trialEndsAt > now ? sub.plan : "FREE";
    case "ACTIVE": {
      // No period end = manually activated open-ended (owner's call) — honor it.
      if (!sub.currentPeriodEnd) return sub.plan;
      const graceEnd = new Date(sub.currentPeriodEnd.getTime() + GRACE_DAYS * 86_400_000);
      return graceEnd > now ? sub.plan : "FREE";
    }
    case "PAST_DUE":
    case "CANCELLED":
    case "FREE_DOWNGRADED":
      return "FREE";
  }
}

export function effectiveLimits(
  sub: SubscriptionLike | null | undefined,
  now: Date = new Date(),
): PlanLimits {
  return PLAN_LIMITS[effectivePlan(sub, now)];
}

/**
 * Load the subscription that governs a salon (salon → account → subscription).
 * Accepts a transaction client so enforcement can run inside the same
 * transaction as the write it guards.
 */
export async function subscriptionForSalon(
  db: Prisma.TransactionClient,
  salonId: string,
): Promise<SubscriptionLike | null> {
  const salon = await db.salon.findUnique({
    where: { id: salonId },
    select: {
      account: {
        select: {
          subscription: {
            select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
          },
        },
      },
    },
  });
  return salon?.account.subscription ?? null;
}

/**
 * Throw (with a user-facing AZ message) if activating/creating one more active
 * employee would exceed the plan's seat limit. Deactivated employees don't
 * consume seats; pass `excludeEmployeeId` when re-saving an existing employee.
 */
export async function assertEmployeeSeatAvailable(
  db: Prisma.TransactionClient,
  salonId: string,
  excludeEmployeeId?: string,
): Promise<void> {
  const sub = await subscriptionForSalon(db, salonId);
  const max = effectiveLimits(sub).maxEmployees;
  if (!Number.isFinite(max)) return;
  const active = await db.employee.count({
    where: {
      salonId,
      isActive: true,
      ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
    },
  });
  if (active >= max) {
    const t = await getTranslations("Workers.errors");
    throw new Error(t("seatLimit", { max }));
  }
}

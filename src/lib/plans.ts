import type { Plan } from "@prisma/client";

export interface PlanLimits {
  /** Use Infinity for "unlimited". */
  maxEmployees: number;
  maxBookingsPerMonth: number;
  maxBranches: number;
  /** Monthly price in qəpik (minor units). */
  priceMinor: number;
}

// Enforcement limits, keyed by the internal Plan enum. FREE is NOT a sold tier —
// it is the zero-entitlement floor an account falls to when a trial lapses or a
// payment is missed (see effectivePlan). The three paid tiers customers actually
// see (Start / Salon / Pro) live in MARKETING_PLANS below; BASIC is the standard
// paid/trial tier (marketed as "Salon"), PRO is the top tier.
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { maxEmployees: 1, maxBookingsPerMonth: 30, maxBranches: 1, priceMinor: 0 },
  BASIC: { maxEmployees: 8, maxBookingsPerMonth: Infinity, maxBranches: 1, priceMinor: 3500 },
  PRO: {
    maxEmployees: Infinity,
    maxBookingsPerMonth: Infinity,
    // Pro includes 3 branches; more are sold as paid extra slots
    // (Subscription.extraBranches, granted by a platform admin).
    maxBranches: 3,
    priceMinor: 7000,
  },
};

/** Price of one extra branch slot beyond the plan's maxBranches, in qəpik. */
export const EXTRA_BRANCH_PRICE_MINOR = 1500;

export interface PlanFeatures {
  multiBranch: boolean;
  advancedAnalytics: boolean;
  staffRoles: boolean;
  exports: boolean;
  /** Deposits / no-show protection (future online payments). Pro only. */
  deposits: boolean;
  /** Employee salary/commission payroll (/dashboard/payroll). Pro only. */
  payroll: boolean;
}

export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  FREE: {
    multiBranch: false,
    advancedAnalytics: false,
    staffRoles: false,
    exports: false,
    deposits: false,
    payroll: false,
  },
  BASIC: {
    multiBranch: false,
    advancedAnalytics: false,
    staffRoles: false,
    exports: false,
    deposits: false,
    payroll: false,
  },
  PRO: {
    multiBranch: true,
    advancedAnalytics: true,
    staffRoles: true,
    exports: true,
    deposits: true,
    payroll: true,
  },
};

/** Every new account gets a no-card free trial of this many days. */
export const TRIAL_DAYS = 14;

// ---------------------------------------------------------------------------
// Marketing pricing (customer-facing). The public site and the owner billing
// page render exactly these three paid tiers — Start, Salon, Pro. Kept separate
// from the enforcement enum on purpose: it is the single source of truth for
// prices, per-tier headline limits and the WhatsApp reminder quota shown to
// prospects, and it never needs a DB migration to change.
// ---------------------------------------------------------------------------

export type MarketingPlanKey = "start" | "salon" | "pro";

export interface MarketingPlan {
  key: MarketingPlanKey;
  /** Monthly price in qəpik (minor units). */
  monthlyMinor: number;
  /** Annual price in qəpik (minor units). */
  annualMinor: number;
  maxEmployees: number; // Infinity = unlimited
  maxBranches: number;
  /** Included WhatsApp reminders per month. */
  waRemindersPerMonth: number;
  /** Advanced feature gate (payroll, roles, exports, deposits) — Pro only. */
  advanced: boolean;
  /** Visually highlighted / recommended card. */
  highlight: boolean;
  /** Shows the "Ən Populyar" badge. */
  popular: boolean;
}

export const MARKETING_PLANS: readonly MarketingPlan[] = [
  {
    key: "start",
    monthlyMinor: 1500,
    annualMinor: 15000,
    maxEmployees: 2,
    maxBranches: 1,
    waRemindersPerMonth: 150,
    advanced: false,
    highlight: false,
    popular: false,
  },
  {
    key: "salon",
    monthlyMinor: 3500,
    annualMinor: 35000,
    maxEmployees: 8,
    maxBranches: 1,
    waRemindersPerMonth: 600,
    advanced: false,
    highlight: true,
    popular: true,
  },
  {
    key: "pro",
    monthlyMinor: 7000,
    annualMinor: 70000,
    maxEmployees: Infinity,
    maxBranches: 3,
    waRemindersPerMonth: 1500,
    advanced: true,
    highlight: false,
    popular: false,
  },
] as const;

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function featuresFor(plan: Plan): PlanFeatures {
  return PLAN_FEATURES[plan];
}

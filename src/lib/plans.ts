import type { Plan } from "@prisma/client";

export interface PlanLimits {
  /** Use Infinity for "unlimited". */
  maxEmployees: number;
  maxBookingsPerMonth: number;
  maxBranches: number;
  /** Monthly price in qəpik (minor units). */
  priceMinor: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  FREE: { maxEmployees: 2, maxBookingsPerMonth: 50, maxBranches: 1, priceMinor: 0 },
  BASIC: { maxEmployees: 10, maxBookingsPerMonth: Infinity, maxBranches: 1, priceMinor: 1500 },
  PRO: {
    maxEmployees: Infinity,
    maxBookingsPerMonth: Infinity,
    // Pro includes 3 branches; more are sold as paid extra slots
    // (Subscription.extraBranches, granted by a platform admin).
    maxBranches: 3,
    priceMinor: 3000,
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

/** Basic plan is free for this many months on invite-gated trials. */
export const TRIAL_MONTHS = 3;

export function limitsFor(plan: Plan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export function featuresFor(plan: Plan): PlanFeatures {
  return PLAN_FEATURES[plan];
}

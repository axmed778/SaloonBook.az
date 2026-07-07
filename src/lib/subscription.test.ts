import { describe, it, expect } from "vitest";
import { effectivePlan, effectiveLimits, GRACE_DAYS, type SubscriptionLike } from "./subscription";

// effectivePlan is the single source of truth for what an account may do RIGHT
// NOW — every enforcement point depends on it, so its edges are pinned here.

const NOW = new Date("2026-07-07T12:00:00Z");
const DAY = 86_400_000;

function sub(partial: Partial<SubscriptionLike>): SubscriptionLike {
  return {
    plan: "BASIC",
    status: "TRIALING",
    trialEndsAt: null,
    currentPeriodEnd: null,
    ...partial,
  };
}

describe("effectivePlan", () => {
  it("no subscription row → FREE", () => {
    expect(effectivePlan(null, NOW)).toBe("FREE");
    expect(effectivePlan(undefined, NOW)).toBe("FREE");
  });

  it("TRIALING with a future trial end → the trial plan", () => {
    const s = sub({ trialEndsAt: new Date(NOW.getTime() + DAY) });
    expect(effectivePlan(s, NOW)).toBe("BASIC");
  });

  it("TRIALING past the trial end → FREE, even before the sweeper runs", () => {
    const s = sub({ trialEndsAt: new Date(NOW.getTime() - 1) });
    expect(effectivePlan(s, NOW)).toBe("FREE");
  });

  it("TRIALING with no trial end (legacy rows) grants nothing", () => {
    expect(effectivePlan(sub({}), NOW)).toBe("FREE");
  });

  it("ACTIVE with no period end is honored open-ended", () => {
    const s = sub({ status: "ACTIVE", plan: "PRO" });
    expect(effectivePlan(s, NOW)).toBe("PRO");
  });

  it("ACTIVE keeps the plan through the manual-billing grace window", () => {
    const s = sub({
      status: "ACTIVE",
      plan: "PRO",
      currentPeriodEnd: new Date(NOW.getTime() - (GRACE_DAYS - 1) * DAY),
    });
    expect(effectivePlan(s, NOW)).toBe("PRO");
  });

  it("ACTIVE past period end + grace → FREE", () => {
    const s = sub({
      status: "ACTIVE",
      plan: "PRO",
      currentPeriodEnd: new Date(NOW.getTime() - (GRACE_DAYS + 1) * DAY),
    });
    expect(effectivePlan(s, NOW)).toBe("FREE");
  });

  it("PAST_DUE / CANCELLED / FREE_DOWNGRADED → FREE regardless of dates", () => {
    const future = new Date(NOW.getTime() + 30 * DAY);
    for (const status of ["PAST_DUE", "CANCELLED", "FREE_DOWNGRADED"] as const) {
      const s = sub({ status, plan: "PRO", trialEndsAt: future, currentPeriodEnd: future });
      expect(effectivePlan(s, NOW)).toBe("FREE");
    }
  });
});

describe("effectiveLimits", () => {
  it("maps the effective plan to its limits (expired trial gets FREE caps)", () => {
    const expired = sub({ trialEndsAt: new Date(NOW.getTime() - DAY) });
    expect(effectiveLimits(expired, NOW).maxBookingsPerMonth).toBe(50);
    expect(effectiveLimits(expired, NOW).maxEmployees).toBe(2);

    const active = sub({ status: "ACTIVE", plan: "PRO" });
    expect(effectiveLimits(active, NOW).maxEmployees).toBe(Infinity);
  });
});

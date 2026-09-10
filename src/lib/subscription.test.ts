import { describe, it, expect } from "vitest";
import {
  effectivePlan,
  effectiveLimits,
  subscriptionWindow,
  GRACE_DAYS,
  type SubscriptionLike,
} from "./subscription";

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
    expect(effectiveLimits(expired, NOW).maxBookingsPerMonth).toBe(30);
    expect(effectiveLimits(expired, NOW).maxEmployees).toBe(1);

    const active = sub({ status: "ACTIVE", plan: "PRO" });
    expect(effectiveLimits(active, NOW).maxEmployees).toBe(Infinity);
  });
});

// The admin salon card reads its countdown from here, so the two must agree
// with effectivePlan: anything this reports as "still has days" must also be
// entitled, and grace has to be visible rather than silently generous.
describe("subscriptionWindow", () => {
  it("no subscription → nothing to count down", () => {
    expect(subscriptionWindow(null, NOW)).toEqual({
      basis: "none",
      endsAt: null,
      daysLeft: null,
      inGrace: false,
      graceDaysLeft: 0,
    });
  });

  it("TRIALING counts down to the trial end", () => {
    const trialEndsAt = new Date(NOW.getTime() + 10 * DAY);
    const w = subscriptionWindow(sub({ trialEndsAt }), NOW);
    expect(w.basis).toBe("trial");
    expect(w.endsAt).toEqual(trialEndsAt);
    expect(w.daysLeft).toBe(10);
    expect(w.inGrace).toBe(false);
  });

  it("TRIALING with no trial end has no countdown (matches effectivePlan → FREE)", () => {
    expect(subscriptionWindow(sub({}), NOW).basis).toBe("none");
    expect(effectivePlan(sub({}), NOW)).toBe("FREE");
  });

  it("ACTIVE with no period end is open-ended, not expired", () => {
    const w = subscriptionWindow(sub({ status: "ACTIVE" }), NOW);
    expect(w.basis).toBe("open");
    expect(w.daysLeft).toBeNull();
    expect(w.endsAt).toBeNull();
  });

  it("ACTIVE counts down to the period end", () => {
    const currentPeriodEnd = new Date(NOW.getTime() + 30 * DAY);
    const w = subscriptionWindow(sub({ status: "ACTIVE", currentPeriodEnd }), NOW);
    expect(w.basis).toBe("period");
    expect(w.daysLeft).toBe(30);
    expect(w.inGrace).toBe(false);
    expect(w.graceDaysLeft).toBe(0);
  });

  it("just past the period end → negative days, still in grace", () => {
    const currentPeriodEnd = new Date(NOW.getTime() - DAY);
    const w = subscriptionWindow(sub({ status: "ACTIVE", currentPeriodEnd }), NOW);
    expect(w.daysLeft).toBe(-1);
    expect(w.inGrace).toBe(true);
    expect(w.graceDaysLeft).toBe(GRACE_DAYS - 1);
    // The card says "in grace" exactly while the account is still entitled.
    expect(effectivePlan(sub({ status: "ACTIVE", currentPeriodEnd }), NOW)).toBe("BASIC");
  });

  it("past the grace window → no grace left, and no entitlement either", () => {
    const currentPeriodEnd = new Date(NOW.getTime() - (GRACE_DAYS + 1) * DAY);
    const w = subscriptionWindow(sub({ status: "ACTIVE", currentPeriodEnd }), NOW);
    expect(w.daysLeft).toBe(-(GRACE_DAYS + 1));
    expect(w.inGrace).toBe(false);
    expect(w.graceDaysLeft).toBe(0);
    expect(effectivePlan(sub({ status: "ACTIVE", currentPeriodEnd }), NOW)).toBe("FREE");
  });

  it("PAST_DUE / CANCELLED keep the last date but stop counting", () => {
    const currentPeriodEnd = new Date(NOW.getTime() - 5 * DAY);
    for (const status of ["PAST_DUE", "CANCELLED", "FREE_DOWNGRADED"] as const) {
      const w = subscriptionWindow(sub({ status, currentPeriodEnd }), NOW);
      expect(w.basis).toBe("none");
      expect(w.daysLeft).toBeNull();
      expect(w.endsAt).toEqual(currentPeriodEnd);
    }
  });

  it("counts whole Baku days, so the number doesn't drift within a day", () => {
    const currentPeriodEnd = new Date("2026-07-17T09:00:00Z");
    const s = sub({ status: "ACTIVE", currentPeriodEnd });
    // 04:30 and 22:00 Baku on the same calendar day must agree.
    const morning = subscriptionWindow(s, new Date("2026-07-07T00:30:00Z"));
    const night = subscriptionWindow(s, new Date("2026-07-07T18:00:00Z"));
    expect(morning.daysLeft).toBe(10);
    expect(night.daysLeft).toBe(10);
  });
});

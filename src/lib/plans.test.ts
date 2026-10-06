import { describe, it, expect } from "vitest";
import { MARKETING_PLANS, PLAN_LIMITS, marketingKeyForPlan, trialPlanForStaff } from "./plans";

// The trial tier is picked at registration from one answer — how many masters
// work in the salon — and nothing else gets to pick it again later. So the rule
// is pinned to the seat limits it is derived from, not to tier names.

describe("trialPlanForStaff", () => {
  it("a salon that fits the smallest tier's seats trials on Start", () => {
    expect(trialPlanForStaff(1)).toBe("START");
    expect(trialPlanForStaff(PLAN_LIMITS.START.maxEmployees)).toBe("START");
  });

  it("one master past Start's seats moves up to Salon", () => {
    expect(trialPlanForStaff(PLAN_LIMITS.START.maxEmployees + 1)).toBe("BASIC");
    expect(trialPlanForStaff(PLAN_LIMITS.BASIC.maxEmployees)).toBe("BASIC");
  });

  it("past the top paid tier's seats there is only Pro, which is unlimited", () => {
    expect(trialPlanForStaff(PLAN_LIMITS.BASIC.maxEmployees + 1)).toBe("PRO");
    expect(trialPlanForStaff(500)).toBe("PRO");
    expect(PLAN_LIMITS.PRO.maxEmployees).toBe(Infinity);
  });

  it("no tier it picks would refuse the masters the salon said it has", () => {
    for (const count of [1, 2, 3, 8, 9, 40]) {
      expect(PLAN_LIMITS[trialPlanForStaff(count)].maxEmployees).toBeGreaterThanOrEqual(count);
    }
  });

  it("a nonsense count still yields the smallest paid tier, never FREE", () => {
    // The API validates (1…500); this is the floor for anything that slips
    // past — a trial must never start on the zero-entitlement plan.
    for (const count of [0, -5, Number.NaN, 0.4]) {
      expect(trialPlanForStaff(count)).toBe("START");
    }
  });
});

describe("marketingKeyForPlan", () => {
  it("every paid plan maps onto a card the pricing page actually renders", () => {
    for (const plan of ["START", "BASIC", "PRO"] as const) {
      const key = marketingKeyForPlan(plan);
      expect(key).not.toBeNull();
      expect(MARKETING_PLANS.some((p) => p.key === key)).toBe(true);
    }
  });

  it("FREE is not sold, so it has no card", () => {
    expect(marketingKeyForPlan("FREE")).toBeNull();
  });
});

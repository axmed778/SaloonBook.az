import { describe, it, expect } from "vitest";
import { agentRewardDue, normalizeAgentCode } from "./referral";

describe("normalizeAgentCode", () => {
  it("upper-cases and trims", () => {
    expect(normalizeAgentCode("  davud ")).toBe("DAVUD");
  });

  it("rejects empty, too short and non-alphanumeric codes", () => {
    expect(normalizeAgentCode("")).toBeNull();
    expect(normalizeAgentCode(null)).toBeNull();
    expect(normalizeAgentCode("ab")).toBeNull();
    expect(normalizeAgentCode("da vud")).toBeNull();
  });
});

describe("agentRewardDue", () => {
  it("a trial with no payment earns nothing", () => {
    expect(agentRewardDue({ plan: "PRO", paidMinor: 0 })).toBe(0);
  });

  it("pays 5 / 10 / 20 ₼ by the tier once the salon has paid", () => {
    expect(agentRewardDue({ plan: "START", paidMinor: 1500 })).toBe(500);
    expect(agentRewardDue({ plan: "BASIC", paidMinor: 3500 })).toBe(1000);
    expect(agentRewardDue({ plan: "PRO", paidMinor: 7000 })).toBe(2000);
  });

  it("a salon that fell back to FREE earns nothing", () => {
    expect(agentRewardDue({ plan: "FREE", paidMinor: 1500 })).toBe(0);
  });
});

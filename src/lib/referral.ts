import type { Plan } from "@prisma/client";

// Sales agents: friends/freelancers who bring salons in with a personal code.
// The agent earns a ONE-OFF reward per salon, and only once that salon has
// actually paid — a trial, however long, earns nothing. The reward depends on
// the tier the salon pays for (owner's terms, 22.10.2026).

/** One-off reward per paying salon, in qəpik, by the tier it pays for. */
export const AGENT_REWARD_MINOR: Record<Plan, number> = {
  FREE: 0,
  START: 500, // 5 ₼
  BASIC: 1000, // "Salon", 10 ₼
  PRO: 2000, // 20 ₼
};

/** Codes are 3–20 letters/digits; stored and compared upper-case. */
export const AGENT_CODE_RE = /^[A-Z0-9]{3,20}$/;

/** Upper-cases and trims a typed or ?ref= code; null when it isn't a valid code. */
export function normalizeAgentCode(raw: string | null | undefined): string | null {
  const code = (raw ?? "").trim().toUpperCase();
  return AGENT_CODE_RE.test(code) ? code : null;
}

/**
 * The reward the agent is owed for one salon right now. Zero until the salon
 * has paid real money for a plan; the tier is the one the subscription is on,
 * so it should be settled soon after the first payment (it is frozen into
 * Account.agentRewardMinor at payout).
 */
export function agentRewardDue(input: { plan: Plan; paidMinor: number }): number {
  return input.paidMinor > 0 ? AGENT_REWARD_MINOR[input.plan] : 0;
}

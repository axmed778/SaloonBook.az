// Which guides a person is offered, and in what state. Decided on the server
// (catalog.ts loads the facts, this decides) and handed to the client as a
// finished list — the client never asks a permission or a plan itself.
//
// PURE, like ../auth/permissions: no Prisma, no cookies.

import type { Plan } from "@prisma/client";
import { accessRefusal, canUpgradePlan, type Permission } from "../auth/permissions";
import { GUIDES, type GuideDef, type GuideId, type GuideLimit, type GuideSection } from "./registry";

/** What the database says, as far as the guides need to know. */
export interface GuideFacts {
  /** The salon has at least one service (an add-on needs one to attach to). */
  hasServices: boolean;
  /** Active employees against the plan's seat limit; max is Infinity when unlimited. */
  employeeSeats: { active: number; max: number };
}

/**
 * A guide as the help panel shows it.
 *   ready  — start it.
 *   plan   — the plan does not include what the guide does. Explain, and show
 *            the way to a plan that does (canUpgrade), or say who can.
 *   limit  — the plan includes it but its limit is used up (every staff seat
 *            taken). Same explanation, with the number.
 *   needs  — something else has to exist first; offer that guide instead.
 * A guide whose ROLE refusal applies is not listed at all: that screen is simply
 * not this person's, and an upgrade card would be a lie.
 */
export type GuideState =
  | { state: "ready" }
  | { state: "plan"; canUpgrade: boolean }
  | { state: "limit"; limit: GuideLimit; max: number; canUpgrade: boolean }
  | { state: "needs"; guide: GuideId };

export type GuideEntry = GuideState & {
  id: GuideId;
  section: GuideSection;
  completed: boolean;
};

interface Subject {
  permissions: readonly Permission[];
  plan: Plan;
}

/** The guides the role may run at all, before the plan or the data is asked. */
export function guidesForRole(subject: Subject): GuideDef[] {
  return (GUIDES as readonly GuideDef[]).filter(
    (g) => accessRefusal(subject, [g.permission]) !== "role",
  );
}

/** Which facts are worth loading for these guides (the rest cost a query for nothing). */
export function factsNeeded(guides: readonly GuideDef[]): {
  services: boolean;
  seats: boolean;
} {
  return {
    services: guides.some((g) => g.needs?.fact === "hasServices"),
    seats: guides.some((g) => g.limit === "employeeSeats"),
  };
}

function stateOf(g: GuideDef, subject: Subject, facts: GuideFacts): GuideState {
  const canUpgrade = canUpgradePlan(subject);
  if (accessRefusal(subject, [g.permission]) === "plan") return { state: "plan", canUpgrade };
  if (g.limit === "employeeSeats") {
    const { active, max } = facts.employeeSeats;
    if (Number.isFinite(max) && active >= max) {
      return { state: "limit", limit: g.limit, max, canUpgrade };
    }
  }
  if (g.needs && !facts[g.needs.fact]) return { state: "needs", guide: g.needs.guide as GuideId };
  return { state: "ready" };
}

/** The finished list for the client, in registry order. */
export function guideCatalog(
  subject: Subject,
  facts: GuideFacts,
  completed: readonly string[],
): GuideEntry[] {
  const done = new Set(completed);
  return guidesForRole(subject).map((g) => ({
    id: g.id as GuideId,
    section: g.section,
    completed: done.has(g.id),
    ...stateOf(g, subject, facts),
  }));
}

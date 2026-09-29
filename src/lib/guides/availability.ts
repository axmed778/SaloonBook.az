// Which guides a person is offered, and in what state. Decided on the server
// (catalog.ts loads the facts, this decides) and handed to the client as a
// finished list — the client never asks a permission or a plan itself.
//
// PURE, like ../auth/permissions: no Prisma, no cookies.

import type { Plan } from "@prisma/client";
import { accessRefusal, canUpgradePlan, type Permission } from "../auth/permissions";
import {
  GUIDES,
  type GuideDef,
  type GuideFact,
  type GuideId,
  type GuideLimit,
  type GuideSection,
} from "./registry";

/** What the database says, as far as the guides need to know. */
export type GuideFacts = Record<GuideFact, boolean> & {
  /** Active employees against the plan's seat limit; max is Infinity when unlimited. */
  employeeSeats: { active: number; max: number };
};

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
  | { state: "needs"; fact: GuideFact; guide: GuideId };

export type GuideEntry = GuideState & {
  id: GuideId;
  section: GuideSection;
  completed: boolean;
};

export interface Subject {
  permissions: readonly Permission[];
  plan: Plan;
}

/** The guides the role may run at all, before the plan or the data is asked. */
export function guidesForRole(subject: Subject): GuideDef[] {
  return (GUIDES as readonly GuideDef[]).filter(
    (g) => accessRefusal(subject, g.permissions) !== "role",
  );
}

/** Which facts are worth loading for these guides (the rest cost a query for nothing). */
export function factsNeeded(guides: readonly GuideDef[]): {
  facts: Set<GuideFact>;
  seats: boolean;
} {
  return {
    facts: new Set(guides.flatMap((g) => (g.needs ?? []).map((n) => n.fact))),
    seats: guides.some((g) => g.limit === "employeeSeats"),
  };
}

function stateOf(g: GuideDef, subject: Subject, facts: GuideFacts): GuideState {
  const canUpgrade = canUpgradePlan(subject);
  if (accessRefusal(subject, g.permissions) === "plan") return { state: "plan", canUpgrade };
  if (g.limit === "employeeSeats") {
    const { active, max } = facts.employeeSeats;
    if (Number.isFinite(max) && active >= max) {
      return { state: "limit", limit: g.limit, max, canUpgrade };
    }
  }
  const unmet = g.needs?.find((n) => !facts[n.fact]);
  if (unmet) return { state: "needs", fact: unmet.fact, guide: unmet.guide as GuideId };
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

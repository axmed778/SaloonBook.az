// The mandatory setup gate: the steps a salon MUST have before the dashboard
// is of any use, in the order a person would do them, decided from the
// database alone — never from a tick someone sets.
//
// Why a gate and not the checklist on Today (src/lib/guides/checklist.ts): the
// checklist waits to be read. A salon that signs up, looks at an empty
// calendar and leaves has a dashboard that cannot do the one thing it was
// bought for — take a booking — and nobody told it which three screens stood
// between it and that. So the gate puts the steps in front of the person, one
// at a time, each explained, each filled in where it is shown: no screen to
// find, no menu to learn.
//
// The checklist stays for what is genuinely optional (the test booking) and for
// the salons that are already past the gate.
//
// PURE, like ./availability and ./checklist: the loader (./load.ts) reads the
// rows, this decides.

/**
 * In order. Each one blocks online booking on its own:
 *   profile — a client needs a phone and an address to trust the page,
 *   service — there is nothing to book without one,
 *   master  — there is nobody to book with,
 *   hours   — availability comes from a master's week; no hours, no slots,
 *   link    — the booking page exists, but nobody has it yet.
 */
export const GATE_STEPS = ["profile", "service", "master", "hours", "link"] as const;

export type GateStepId = (typeof GATE_STEPS)[number];

/** What the salon's own rows say, as the gate reads them. */
export interface GateFacts {
  /** Phone and address both filled in. */
  profileComplete: boolean;
  hasActiveServices: boolean;
  hasActiveEmployees: boolean;
  /** At least one active master has working hours — what slots come from. */
  hasStaffHours: boolean;
  /** The booking link has been copied, or a client has already booked through it. */
  linkShared: boolean;
}

export interface GateStep {
  id: GateStepId;
  done: boolean;
}

export interface GateState {
  steps: GateStep[];
  /** The step the person is on: the first one not done. */
  current: GateStepId;
  done: number;
  total: number;
}

export function stepDone(id: GateStepId, facts: GateFacts): boolean {
  switch (id) {
    case "profile":
      return facts.profileComplete;
    case "service":
      return facts.hasActiveServices;
    case "master":
      return facts.hasActiveEmployees;
    case "hours":
      return facts.hasStaffHours;
    case "link":
      return facts.linkShared;
  }
}

/**
 * The gate for these facts, or null when there is nothing left to ask — which
 * is also what keeps it away from every salon that was set up before it
 * existed: their own rows answer all five steps.
 *
 * Steps already satisfied stay in the list (the person sees what is behind
 * them) but `current` skips to the first one that is not: a salon that filled
 * its profile in and stopped is asked for a service, not for the profile again.
 */
export function buildGate(facts: GateFacts): GateState | null {
  const steps = GATE_STEPS.map((id) => ({ id, done: stepDone(id, facts) }));
  const current = steps.find((s) => !s.done);
  if (!current) return null;
  return {
    steps,
    current: current.id,
    done: steps.filter((s) => s.done).length,
    total: steps.length,
  };
}

import { describe, it, expect } from "vitest";
import { GATE_STEPS, buildGate, stepDone, type GateFacts } from "./gate";

// The gate blocks the dashboard, so the rule for WHEN it blocks is the part
// that must not drift: a salon whose rows already answer every step must never
// see it, and a step must never be satisfiable by anything but the data.

function facts(partial: Partial<GateFacts> = {}): GateFacts {
  return {
    profileComplete: false,
    hasActiveServices: false,
    hasBookableMaster: false,
    hasStaffHours: false,
    linkShared: false,
    ...partial,
  };
}

const ALL_DONE: GateFacts = {
  profileComplete: true,
  hasActiveServices: true,
  hasBookableMaster: true,
  hasStaffHours: true,
  linkShared: true,
};

describe("buildGate", () => {
  it("a salon with nothing set up starts on the profile", () => {
    const gate = buildGate(facts());
    expect(gate?.current).toBe("profile");
    expect(gate?.done).toBe(0);
    expect(gate?.total).toBe(GATE_STEPS.length);
  });

  it("a salon that answers every step is never gated", () => {
    expect(buildGate(ALL_DONE)).toBeNull();
  });

  it("skips to the first step the data does not answer", () => {
    expect(buildGate(facts({ profileComplete: true }))?.current).toBe("service");
    expect(
      buildGate(facts({ profileComplete: true, hasActiveServices: true }))?.current,
    ).toBe("master");
    expect(buildGate({ ...ALL_DONE, hasStaffHours: false })?.current).toBe("hours");
    expect(buildGate({ ...ALL_DONE, linkShared: false })?.current).toBe("link");
  });

  it("a step done out of order still counts, and the gate asks for what is left", () => {
    // Someone who filled the profile in on the Settings screen and added a
    // master, but has no service: 2 done, asked for the service.
    const gate = buildGate(facts({ profileComplete: true, hasBookableMaster: true }));
    expect(gate?.current).toBe("service");
    expect(gate?.done).toBe(2);
    expect(gate?.steps.filter((s) => s.done).map((s) => s.id)).toEqual(["profile", "master"]);
  });

  it("every step keeps its place in the list, done or not", () => {
    const gate = buildGate(facts({ hasStaffHours: true }));
    expect(gate?.steps.map((s) => s.id)).toEqual([...GATE_STEPS]);
  });
});

describe("stepDone", () => {
  it("reads exactly one fact per step", () => {
    const only = (key: keyof GateFacts) => facts({ [key]: true });
    expect(stepDone("profile", only("profileComplete"))).toBe(true);
    expect(stepDone("service", only("hasActiveServices"))).toBe(true);
    expect(stepDone("master", only("hasBookableMaster"))).toBe(true);
    expect(stepDone("hours", only("hasStaffHours"))).toBe(true);
    expect(stepDone("link", only("linkShared"))).toBe(true);
    // And nothing else makes a step pass: the profile is not done because a
    // service exists.
    expect(stepDone("profile", only("hasActiveServices"))).toBe(false);
  });
});

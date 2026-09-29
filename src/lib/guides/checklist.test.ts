import { describe, it, expect } from "vitest";
import type { Plan } from "@prisma/client";
import { APP_ROLES, rolePermissions, type AppRole } from "../auth/permissions";
import { buildSetup, isProfileComplete, setupEligible, SETUP_ITEMS, type SetupFacts, type SetupUserState } from "./checklist";

// The first-run checklist: ticked by the salon's data, shown to whoever may do
// every step, gone once everything is done. The welcome: new sign-ups only.

const subject = (role: AppRole, plan: Plan = "BASIC") => ({ permissions: rolePermissions(role), plan });

const NOTHING: SetupFacts = {
  profileComplete: false,
  hasActiveServices: false,
  hasActiveEmployees: false,
  hasStaffHours: false,
  linkCopied: false,
  hasOnlineBooking: false,
  hasAppointments: false,
};
const EVERYTHING: SetupFacts = {
  profileComplete: true,
  hasActiveServices: true,
  hasActiveEmployees: true,
  hasStaffHours: true,
  linkCopied: true,
  hasOnlineBooking: true,
  hasAppointments: true,
};
const NEW_SIGNUP: SetupUserState = { onboardingStartedAt: new Date(), welcomeShownAt: null, checklistHidden: false };
const EXISTING: SetupUserState = { onboardingStartedAt: null, welcomeShownAt: null, checklistHidden: false };

const doneIds = (facts: SetupFacts) =>
  buildSetup(subject("OWNER"), facts, EXISTING)
    ?.items.filter((i) => i.done)
    .map((i) => i.id) ?? "all done";

describe("who gets the checklist", () => {
  it("is the owner today — asked through permissions, not the role name", () => {
    const eligible = APP_ROLES.filter((r) => setupEligible(subject(r)));
    expect(eligible).toEqual(["OWNER"]);
  });

  it("is nobody else, whatever their data", () => {
    for (const role of APP_ROLES.filter((r) => r !== "OWNER")) {
      expect(buildSetup(subject(role), NOTHING, NEW_SIGNUP), role).toBeNull();
    }
  });

  it("does not depend on the plan for the six steps (none of them is plan-gated)", () => {
    expect(setupEligible(subject("OWNER", "FREE"))).toBe(true);
  });
});

describe("what ticks each item", () => {
  it("starts at nothing for an empty salon, in the fixed order", () => {
    const s = buildSetup(subject("OWNER"), NOTHING, NEW_SIGNUP)!;
    expect(s.items.map((i) => i.id)).toEqual(SETUP_ITEMS.map((i) => i.id));
    expect(s.done).toBe(0);
    expect(s.total).toBe(6);
  });

  it("ticks each item from its own fact", () => {
    expect(doneIds({ ...NOTHING, profileComplete: true })).toEqual(["profile"]);
    expect(doneIds({ ...NOTHING, hasActiveServices: true })).toEqual(["services"]);
    expect(doneIds({ ...NOTHING, hasActiveEmployees: true })).toEqual(["worker"]);
    expect(doneIds({ ...NOTHING, hasStaffHours: true })).toEqual(["hours"]);
    expect(doneIds({ ...NOTHING, hasAppointments: true })).toEqual(["booking"]);
  });

  it("counts the link as shared when it was copied, or when a client booked through it", () => {
    expect(doneIds({ ...NOTHING, linkCopied: true })).toEqual(["link"]);
    expect(doneIds({ ...NOTHING, hasOnlineBooking: true })).toEqual(["link"]);
  });

  it("maps every item to the guide that shows how", () => {
    const s = buildSetup(subject("OWNER"), NOTHING, EXISTING)!;
    expect(Object.fromEntries(s.items.map((i) => [i.id, i.guide]))).toEqual({
      profile: "salonProfile",
      services: "addService",
      worker: "addWorker",
      hours: "workingHours",
      link: "bookingLink",
      booking: "manualBooking",
    });
  });

  it("needs both phone and address for the profile", () => {
    expect(isProfileComplete({ phone: "+994501234567", address: "Nizami 1" })).toBe(true);
    expect(isProfileComplete({ phone: "+994501234567", address: null })).toBe(false);
    expect(isProfileComplete({ phone: "   ", address: "Nizami 1" })).toBe(false);
  });
});

describe("when it shows", () => {
  it("is gone once every item is done — for a salon set up long before it existed too", () => {
    expect(buildSetup(subject("OWNER"), EVERYTHING, EXISTING)).toBeNull();
    expect(buildSetup(subject("OWNER"), EVERYTHING, NEW_SIGNUP)).toBeNull();
  });

  it("shows an existing salon exactly what it still misses", () => {
    const s = buildSetup(subject("OWNER"), { ...EVERYTHING, profileComplete: false }, EXISTING)!;
    expect(s.items.filter((i) => !i.done).map((i) => i.id)).toEqual(["profile"]);
  });

  it("carries the person's own hide", () => {
    expect(buildSetup(subject("OWNER"), NOTHING, { ...EXISTING, checklistHidden: true })?.hidden).toBe(true);
    expect(buildSetup(subject("OWNER"), NOTHING, EXISTING)?.hidden).toBe(false);
  });
});

describe("the welcome", () => {
  it("is for a new sign-up that has not seen it", () => {
    expect(buildSetup(subject("OWNER"), NOTHING, NEW_SIGNUP)?.welcome).toBe(true);
  });

  it("is never for an account from before the first-run flow", () => {
    expect(buildSetup(subject("OWNER"), NOTHING, EXISTING)?.welcome).toBe(false);
  });

  it("is shown once", () => {
    expect(buildSetup(subject("OWNER"), NOTHING, { ...NEW_SIGNUP, welcomeShownAt: new Date() })?.welcome).toBe(false);
  });
});

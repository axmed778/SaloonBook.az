import { describe, it, expect } from "vitest";
import type { Plan } from "@prisma/client";
import { APP_ROLES, rolePermissions, type AppRole } from "../auth/permissions";
import { factsNeeded, guideCatalog, guidesForRole, type GuideFacts } from "./availability";
import { GUIDES, type GuideDef } from "./registry";

// Which guides each person is offered is decided on the server from the same
// permission table the pages use. These pin the outcomes the product relies on.

const subject = (role: AppRole, plan: Plan = "BASIC") => ({ permissions: rolePermissions(role), plan });

const FACTS: GuideFacts = {
  hasServices: true,
  hasActiveServices: true,
  hasActiveEmployees: true,
  hasBookableStaff: true,
  employeeSeats: { active: 1, max: 8 },
};
const ids = (role: AppRole, plan: Plan = "BASIC", facts = FACTS) =>
  guideCatalog(subject(role, plan), facts, []).map((g) => g.id);
const entry = (id: string, facts: GuideFacts, role: AppRole = "OWNER", plan: Plan = "BASIC") =>
  guideCatalog(subject(role, plan), facts, []).find((g) => g.id === id);

describe("guides by role", () => {
  it("offers the owner every guide but the ones meant for roles without their screen", () => {
    const perms = rolePermissions("OWNER");
    expect(ids("OWNER")).toEqual(
      (GUIDES as readonly GuideDef[]).filter((g) => !(g.hideWith && perms.includes(g.hideWith))).map((g) => g.id),
    );
    expect(ids("OWNER")).not.toContain("timeOffReception");
  });

  it("lists a guide exactly when the role holds every permission it needs", () => {
    for (const role of APP_ROLES) {
      const perms = rolePermissions(role);
      const got: string[] = ids(role);
      for (const g of GUIDES as readonly GuideDef[]) {
        const allowed = g.permissions.every((p) => perms.includes(p));
        const hidden = !!g.hideWith && perms.includes(g.hideWith);
        expect(got.includes(g.id), `${role}: ${g.id}`).toBe(allowed && !hidden);
      }
    }
  });

  it("spells today's table out, so a change to it is a visible decision", () => {
    // Reception and masters take bookings; nobody but the owner sets the salon up.
    expect(ids("ADMIN")).toEqual(["manualBooking", "timeOffReception"]);
    expect(ids("MASTER")).toEqual(["manualBooking"]);
    expect(ids("FINANCE")).toEqual([]);
  });

  it("needs every permission of a guide that crosses screens", () => {
    // Working hours walks Staff then Settings: staff.manage alone is not enough.
    const staffOnly = { permissions: ["staff.manage", "bookings.read"] as const, plan: "BASIC" as Plan };
    expect(guidesForRole(staffOnly).map((g) => g.id)).not.toContain("workingHours");
  });
});

describe("guides against the plan and the data", () => {
  it("explains a full staff plan instead of walking into the refusal", () => {
    const full = { ...FACTS, employeeSeats: { active: 2, max: 2 } };
    expect(entry("addWorker", full, "OWNER", "START")).toMatchObject({
      state: "limit",
      limit: "employeeSeats",
      max: 2,
      canUpgrade: true,
    });
  });

  it("does not count an unlimited plan as full", () => {
    const pro = { ...FACTS, employeeSeats: { active: 50, max: Infinity } };
    expect(entry("addWorker", pro, "OWNER", "PRO")?.state).toBe("ready");
  });

  it("offers the service guide first when an add-on has nothing to attach to", () => {
    const empty = { ...FACTS, hasServices: false };
    expect(entry("addAddon", empty)).toMatchObject({ state: "needs", fact: "hasServices", guide: "addService" });
    expect(entry("addService", empty)?.state).toBe("ready");
  });

  it("sends a booking to the first thing missing: a service, then a master who can take it", () => {
    const noServices = { ...FACTS, hasActiveServices: false, hasBookableStaff: false };
    expect(entry("manualBooking", noServices)).toMatchObject({ fact: "hasActiveServices", guide: "addService" });
    const noStaff = { ...FACTS, hasBookableStaff: false };
    expect(entry("manualBooking", noStaff)).toMatchObject({ fact: "hasBookableStaff", guide: "addWorker" });
  });

  it("asks for a master before their working hours", () => {
    expect(entry("workingHours", { ...FACTS, hasActiveEmployees: false })).toMatchObject({
      state: "needs",
      guide: "addWorker",
    });
  });

  it("tells a non-owner to ask, not to upgrade", () => {
    const full = { ...FACTS, employeeSeats: { active: 2, max: 2 } };
    // No role but the owner runs addWorker today, so check the flag on the owner
    // and the rule on a permission set without billing.manage.
    const manager = { permissions: ["staff.manage"] as const, plan: "START" as Plan };
    const got = guideCatalog(manager, full, []).find((g) => g.id === "addWorker");
    expect(got).toMatchObject({ state: "limit", canUpgrade: false });
  });

  it("marks finished guides, and ignores ids it does not know", () => {
    const list = guideCatalog(subject("OWNER"), FACTS, ["addService", "gone"]);
    expect(list.find((g) => g.id === "addService")?.completed).toBe(true);
    expect(list.find((g) => g.id === "addWorker")?.completed).toBe(false);
    expect(list).toHaveLength(ids("OWNER").length);
  });

  it("loads only the facts the offered guides need", () => {
    const owner = factsNeeded(guidesForRole(subject("OWNER")));
    expect([...owner.facts].sort()).toEqual(
      ["hasActiveEmployees", "hasActiveServices", "hasBookableStaff", "hasServices"].sort(),
    );
    expect(owner.seats).toBe(true);
    const finance = factsNeeded(guidesForRole(subject("FINANCE")));
    expect(finance.facts.size).toBe(0);
    expect(finance.seats).toBe(false);
  });
});

describe("guides that hand out a login", () => {
  it("explain the plan when it has no staff logins, instead of opening a refusing form", () => {
    // FREE has no staff logins (ROLE_PLAN_FEATURE); the owner still manages staff.
    expect(entry("masterLogin", FACTS, "OWNER", "FREE")).toMatchObject({ state: "plan", canUpgrade: true });
    expect(entry("masterLogin", FACTS, "OWNER", "START")?.state).toBe("ready");
  });

  it("ask for a master to give the login to", () => {
    expect(entry("masterLogin", { ...FACTS, hasActiveEmployees: false })).toMatchObject({
      state: "needs",
      guide: "addWorker",
    });
  });
});


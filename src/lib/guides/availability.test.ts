import { describe, it, expect } from "vitest";
import type { Plan } from "@prisma/client";
import { APP_ROLES, rolePermissions, type AppRole } from "../auth/permissions";
import { factsNeeded, guideCatalog, guidesForRole, type GuideFacts } from "./availability";

// Which guides each person is offered is decided on the server from the same
// permission table the pages use. These pin the outcomes the product relies on.

const subject = (role: AppRole, plan: Plan = "BASIC") => ({ permissions: rolePermissions(role), plan });

const FACTS: GuideFacts = { hasServices: true, employeeSeats: { active: 1, max: 8 } };
const ids = (role: AppRole, plan: Plan = "BASIC", facts = FACTS) =>
  guideCatalog(subject(role, plan), facts, []).map((g) => g.id);

describe("guides by role", () => {
  it("offers the owner every guide", () => {
    expect(ids("OWNER")).toEqual(["addService", "addAddon", "addWorker"]);
  });

  it("lists none of the service or staff guides for roles without those screens", () => {
    for (const role of APP_ROLES) {
      const perms = rolePermissions(role);
      const got = ids(role);
      expect(got.includes("addService"), role).toBe(perms.includes("services.write"));
      expect(got.includes("addAddon"), role).toBe(perms.includes("services.write"));
      expect(got.includes("addWorker"), role).toBe(perms.includes("staff.manage"));
    }
    // Spelled out for today's table, so a change to it is a visible decision.
    expect(ids("ADMIN")).toEqual([]);
    expect(ids("FINANCE")).toEqual([]);
    expect(ids("MASTER")).toEqual([]);
  });

  it("never lists a guide as ready for a role the permission table refuses", () => {
    for (const role of APP_ROLES) {
      const perms = rolePermissions(role);
      for (const g of guidesForRole(subject(role))) {
        expect(perms, `${role}: ${g.id}`).toContain(g.permission);
      }
    }
  });
});

describe("guides against the plan and the data", () => {
  it("explains a full staff plan instead of walking into the refusal", () => {
    const full = { ...FACTS, employeeSeats: { active: 2, max: 2 } };
    const worker = guideCatalog(subject("OWNER", "START"), full, []).find((g) => g.id === "addWorker");
    expect(worker).toMatchObject({ state: "limit", limit: "employeeSeats", max: 2, canUpgrade: true });
  });

  it("does not count an unlimited plan as full", () => {
    const pro = { ...FACTS, employeeSeats: { active: 50, max: Infinity } };
    const worker = guideCatalog(subject("OWNER", "PRO"), pro, []).find((g) => g.id === "addWorker");
    expect(worker?.state).toBe("ready");
  });

  it("offers the service guide first when an add-on has nothing to attach to", () => {
    const empty = { ...FACTS, hasServices: false };
    const addon = guideCatalog(subject("OWNER"), empty, []).find((g) => g.id === "addAddon");
    expect(addon).toMatchObject({ state: "needs", guide: "addService" });
    const service = guideCatalog(subject("OWNER"), empty, []).find((g) => g.id === "addService");
    expect(service?.state).toBe("ready");
  });

  it("marks finished guides, and ignores ids it does not know", () => {
    const list = guideCatalog(subject("OWNER"), FACTS, ["addService", "gone"]);
    expect(list.find((g) => g.id === "addService")?.completed).toBe(true);
    expect(list.find((g) => g.id === "addWorker")?.completed).toBe(false);
    expect(list).toHaveLength(3);
  });

  it("loads only the facts the offered guides need", () => {
    expect(factsNeeded(guidesForRole(subject("OWNER")))).toEqual({ services: true, seats: true });
    expect(factsNeeded(guidesForRole(subject("MASTER")))).toEqual({ services: false, seats: false });
  });
});

import { describe, it, expect } from "vitest";
import {
  OWNER_ONLY_SECTIONS,
  appointmentScope,
  canActForEmployee,
  canOpenSection,
  isOwnerOnlySection,
  isStaffScope,
  staffBlockedReason,
  type SalonScope,
} from "./access";
import { PLAN_FEATURES } from "../plans";

// The rules that keep one master out of another master's day — and out of the
// owner's books. They are pure on purpose: this is the layer that has to be
// exhaustively checked, and it should not need a database to check it.

const OWNER: SalonScope = { salonId: "salon-1", employeeId: null };
const MASTER: SalonScope = { salonId: "salon-1", employeeId: "emp-1" };

describe("appointmentScope", () => {
  it("gives the owner the whole salon", () => {
    expect(appointmentScope(OWNER)).toEqual({ salonId: "salon-1" });
  });

  it("pins a master to their own rows", () => {
    expect(appointmentScope(MASTER)).toEqual({ salonId: "salon-1", employeeId: "emp-1" });
  });

  it("always carries the tenant guard, never the employee guard alone", () => {
    for (const scope of [OWNER, MASTER]) {
      expect(appointmentScope(scope).salonId).toBe("salon-1");
    }
  });
});

describe("canActForEmployee", () => {
  it("lets the owner book for anyone", () => {
    expect(canActForEmployee(OWNER, "emp-1")).toBe(true);
    expect(canActForEmployee(OWNER, "emp-2")).toBe(true);
  });

  it("lets a master act only for themselves", () => {
    expect(canActForEmployee(MASTER, "emp-1")).toBe(true);
    expect(canActForEmployee(MASTER, "emp-2")).toBe(false);
  });
});

describe("isStaffScope", () => {
  it("distinguishes a master's scope from the owner's", () => {
    expect(isStaffScope(MASTER)).toBe(true);
    expect(isStaffScope(OWNER)).toBe(false);
  });
});

describe("isOwnerOnlySection", () => {
  it("covers every listed section and its sub-routes", () => {
    for (const section of OWNER_ONLY_SECTIONS) {
      expect(isOwnerOnlySection(section)).toBe(true);
      expect(isOwnerOnlySection(`${section}/whatever`)).toBe(true);
    }
  });

  it("leaves a master their own day", () => {
    expect(isOwnerOnlySection("/dashboard")).toBe(false);
    expect(isOwnerOnlySection("/dashboard/calendar")).toBe(false);
    expect(isOwnerOnlySection("/dashboard/calendar?view=week")).toBe(false);
  });

  it("does not match a section that merely shares a prefix", () => {
    // A plain startsWith() would have swallowed these.
    expect(isOwnerOnlySection("/dashboard/clientsx")).toBe(false);
    expect(isOwnerOnlySection("/dashboard/settings-export")).toBe(false);
  });

  it("names the money, the client base and the other masters", () => {
    // Guards against a section being quietly dropped from the list.
    expect([...OWNER_ONLY_SECTIONS]).toEqual([
      "/dashboard/clients",
      "/dashboard/services",
      "/dashboard/workers",
      "/dashboard/analytics",
      "/dashboard/payroll",
      "/dashboard/settings",
      "/dashboard/billing",
      "/dashboard/admin",
    ]);
  });
});

describe("canOpenSection", () => {
  it("refuses a master every owner-only section", () => {
    for (const section of OWNER_ONLY_SECTIONS) {
      expect(canOpenSection("STAFF", section)).toBe(false);
    }
  });

  it("admits a master to the calendar and today", () => {
    expect(canOpenSection("STAFF", "/dashboard")).toBe(true);
    expect(canOpenSection("STAFF", "/dashboard/calendar")).toBe(true);
  });

  it("admits the owner everywhere", () => {
    for (const section of OWNER_ONLY_SECTIONS) {
      expect(canOpenSection("OWNER", section)).toBe(true);
    }
  });
});

describe("staffBlockedReason", () => {
  const active = { isStaff: true, staffRolesEnabled: true, employeeIsActive: true };

  it("never blocks the owner", () => {
    expect(
      staffBlockedReason({ isStaff: false, staffRolesEnabled: false, employeeIsActive: false }),
    ).toBeNull();
  });

  it("lets a working master in", () => {
    expect(staffBlockedReason(active)).toBeNull();
  });

  it("closes the login when the plan loses the feature", () => {
    expect(staffBlockedReason({ ...active, staffRolesEnabled: false })).toBe("plan");
  });

  it("closes the login when the master is deactivated", () => {
    expect(staffBlockedReason({ ...active, employeeIsActive: false })).toBe("inactive");
  });

  it("closes the login when the employee record no longer resolves", () => {
    expect(staffBlockedReason({ ...active, employeeIsActive: null })).toBe("inactive");
    expect(staffBlockedReason({ ...active, employeeIsActive: undefined })).toBe("inactive");
  });

  it("reports the plan first — that is the one the owner can act on", () => {
    expect(
      staffBlockedReason({ isStaff: true, staffRolesEnabled: false, employeeIsActive: false }),
    ).toBe("plan");
  });
});

describe("plan entitlement", () => {
  it("ships staff logins on every paid tier", () => {
    expect(PLAN_FEATURES.START.staffRoles).toBe(true);
    expect(PLAN_FEATURES.BASIC.staffRoles).toBe(true);
    expect(PLAN_FEATURES.PRO.staffRoles).toBe(true);
  });

  it("withholds them on FREE, the lapsed-trial floor", () => {
    expect(PLAN_FEATURES.FREE.staffRoles).toBe(false);
  });
});

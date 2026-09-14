import { describe, it, expect } from "vitest";
import {
  appointmentScope,
  canActForEmployee,
  isStaffScope,
  salonScopeFor,
  staffBlockedReason,
  type SalonScope,
} from "./access";
import { PLAN_FEATURES } from "../plans";

// The rules that keep one master out of another master's day — and out of the
// salon's books. They are pure on purpose: this is the layer that has to be
// exhaustively checked, and it should not need a database to check it. Which
// sections and actions each role gets is covered in permissions.test.ts.

const SALON: SalonScope = { salonId: "salon-1", employeeId: null };
const MASTER: SalonScope = { salonId: "salon-1", employeeId: "emp-1" };

describe("salonScopeFor", () => {
  it("gives the owner, reception and finance the whole salon", () => {
    for (const appRole of ["OWNER", "ADMIN", "FINANCE"] as const) {
      expect(salonScopeFor({ salonId: "salon-1", appRole, employeeId: null })).toEqual(SALON);
    }
  });

  it("does not narrow a salon-wide role that is linked to an employee", () => {
    // Reception or finance may be linked to an employee to see their own payout
    // statement; that link must not shrink the bookings they work with.
    expect(salonScopeFor({ salonId: "salon-1", appRole: "ADMIN", employeeId: "emp-7" })).toEqual(
      SALON,
    );
  });

  it("pins a master to their own employee", () => {
    expect(salonScopeFor({ salonId: "salon-1", appRole: "MASTER", employeeId: "emp-1" })).toEqual(
      MASTER,
    );
  });

  it("refuses a master's login with no employee instead of widening it to the salon", () => {
    expect(salonScopeFor({ salonId: "salon-1", appRole: "MASTER", employeeId: null })).toBeNull();
  });

  it("refuses a session without a role", () => {
    expect(salonScopeFor({ salonId: "salon-1", appRole: null, employeeId: null })).toBeNull();
  });
});

describe("appointmentScope", () => {
  it("gives a salon-wide scope the whole salon", () => {
    expect(appointmentScope(SALON)).toEqual({ salonId: "salon-1" });
  });

  it("pins a master to their own rows", () => {
    expect(appointmentScope(MASTER)).toEqual({ salonId: "salon-1", employeeId: "emp-1" });
  });

  it("always carries the tenant guard, never the employee guard alone", () => {
    for (const scope of [SALON, MASTER]) {
      expect(appointmentScope(scope).salonId).toBe("salon-1");
    }
  });
});

describe("canActForEmployee", () => {
  it("lets a salon-wide scope book for anyone", () => {
    expect(canActForEmployee(SALON, "emp-1")).toBe(true);
    expect(canActForEmployee(SALON, "emp-2")).toBe(true);
  });

  it("lets a master act only for themselves", () => {
    expect(canActForEmployee(MASTER, "emp-1")).toBe(true);
    expect(canActForEmployee(MASTER, "emp-2")).toBe(false);
  });
});

describe("isStaffScope", () => {
  it("distinguishes a master's scope from the salon's", () => {
    expect(isStaffScope(MASTER)).toBe(true);
    expect(isStaffScope(SALON)).toBe(false);
  });
});

describe("staffBlockedReason", () => {
  const active = { employeeLogin: true, staffRolesEnabled: true, employeeIsActive: true };

  it("never blocks a login that is not an employee's", () => {
    expect(
      staffBlockedReason({ employeeLogin: false, staffRolesEnabled: false, employeeIsActive: false }),
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
      staffBlockedReason({ employeeLogin: true, staffRolesEnabled: false, employeeIsActive: false }),
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

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
  const master = {
    roleOnPlan: true,
    branchActive: true,
    disabled: false,
    employeeLogin: true,
    employeeIsActive: true,
  };
  // Reception or finance: not an employee's login, so no employee to consult.
  const team = {
    roleOnPlan: true,
    branchActive: true,
    disabled: false,
    employeeLogin: false,
    employeeIsActive: undefined,
  };

  it("closes a login whose branch is not active", () => {
    expect(staffBlockedReason({ ...master, branchActive: false })).toBe("branch");
    expect(staffBlockedReason({ ...team, branchActive: false })).toBe("branch");
  });

  it("reports the branch before a switch-off or a deactivated master", () => {
    expect(
      staffBlockedReason({ ...master, branchActive: false, disabled: true, employeeIsActive: false }),
    ).toBe("branch");
  });

  it("lets a working master in", () => {
    expect(staffBlockedReason(master)).toBeNull();
  });

  it("lets a working team login in without an employee behind it", () => {
    expect(staffBlockedReason(team)).toBeNull();
  });

  it("closes any login whose plan does not include its role", () => {
    expect(staffBlockedReason({ ...master, roleOnPlan: false })).toBe("plan");
    expect(staffBlockedReason({ ...team, roleOnPlan: false })).toBe("plan");
  });

  it("closes any login the owner switched off", () => {
    expect(staffBlockedReason({ ...master, disabled: true })).toBe("inactive");
    expect(staffBlockedReason({ ...team, disabled: true })).toBe("inactive");
  });

  it("closes a master's login when the master is deactivated", () => {
    expect(staffBlockedReason({ ...master, employeeIsActive: false })).toBe("inactive");
  });

  it("closes a master's login when the employee record no longer resolves", () => {
    expect(staffBlockedReason({ ...master, employeeIsActive: null })).toBe("inactive");
    expect(staffBlockedReason({ ...master, employeeIsActive: undefined })).toBe("inactive");
  });

  it("does not close a team login because the employee it is linked to was deactivated", () => {
    expect(staffBlockedReason({ ...team, employeeIsActive: false })).toBeNull();
  });

  it("reports the plan first — that is the one the owner can act on", () => {
    expect(
      staffBlockedReason({
        roleOnPlan: false,
        branchActive: false,
        disabled: true,
        employeeLogin: true,
        employeeIsActive: false,
      }),
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

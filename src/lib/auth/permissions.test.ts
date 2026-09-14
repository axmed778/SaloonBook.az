import { describe, it, expect } from "vitest";
import type { Plan } from "@prisma/client";
import {
  APP_ROLES,
  PERMISSIONS,
  SECTION_PERMISSIONS,
  appRoleOf,
  can,
  canOpenSection,
  hasPermission,
  isEmployeeLogin,
  planIncludes,
  rolePermissions,
  sectionPermission,
  seesOnlyOwnRows,
  spansAllBranches,
  type Permission,
} from "./permissions";

// The permission matrix approved for the finance module, written out cell by
// cell. It is a second copy of ROLE_PERMISSIONS on purpose, not an import of it:
// changing who may do what takes an edit here as well as in permissions.ts, or
// this suite fails.

const Y = true;
const N = false;

// prettier-ignore
const ROLE_MATRIX: Record<Permission, readonly [owner: boolean, admin: boolean, finance: boolean, master: boolean]> = {
  "bookings.read":        [Y, Y, Y, Y],
  "bookings.write":       [Y, Y, N, Y],
  "clients.read":         [Y, Y, Y, N],
  "clients.write":        [Y, Y, N, N],
  "clients.delete":       [Y, N, N, N],
  "schedule.read":        [Y, Y, Y, N],
  "schedule.write":       [Y, Y, N, N],
  "services.write":       [Y, N, N, N],
  "staff.manage":         [Y, N, N, N],
  "roles.assign":         [Y, N, N, N],
  "settings.write":       [Y, N, N, N],
  "billing.manage":       [Y, N, N, N],
  "analytics.view":       [Y, N, Y, N],
  "exports.data":         [Y, N, Y, N],
  "payroll.manage":       [Y, N, N, N],
  "payments.read":        [Y, Y, Y, N],
  "payments.write":       [Y, Y, N, N],
  "payments.edit_closed": [Y, N, N, N],
  "shift.view_current":   [Y, Y, Y, N],
  "shift.close":          [Y, Y, N, N],
  "shift.reopen":         [Y, N, N, N],
  "shift.view_history":   [Y, N, Y, N],
  "payouts.view_own":     [Y, Y, Y, Y],
  "payouts.view_all":     [Y, N, Y, N],
  "payouts.configure":    [Y, N, N, N], // FINANCE only through the owner's switch
  "payouts.adjust":       [Y, N, Y, N],
  "payouts.confirm":      [Y, N, Y, N],
  "payouts.mark_paid":    [Y, N, Y, N],
  "expenses.read":        [Y, N, Y, N],
  "expenses.write":       [Y, N, Y, N],
  "reports.finance":      [Y, N, Y, N],
  "exports.finance":      [Y, N, Y, N],
  "finance.settings":     [Y, N, N, N],
};

const PLANS: readonly Plan[] = ["FREE", "START", "BASIC", "PRO"];

// Start = payments only; Salon (BASIC) = + shift close, payouts, expenses;
// Pro = + finance reports and exports. Reads are on every plan.
// prettier-ignore
const PLAN_MATRIX: Record<Permission, readonly [free: boolean, start: boolean, basic: boolean, pro: boolean]> = {
  "bookings.read":        [Y, Y, Y, Y],
  "bookings.write":       [Y, Y, Y, Y],
  "clients.read":         [Y, Y, Y, Y],
  "clients.write":        [Y, Y, Y, Y],
  "clients.delete":       [Y, Y, Y, Y],
  "schedule.read":        [Y, Y, Y, Y],
  "schedule.write":       [Y, Y, Y, Y],
  "services.write":       [Y, Y, Y, Y],
  "staff.manage":         [Y, Y, Y, Y],
  "roles.assign":         [Y, Y, Y, Y],
  "settings.write":       [Y, Y, Y, Y],
  "billing.manage":       [Y, Y, Y, Y],
  "analytics.view":       [Y, Y, Y, Y],
  "exports.data":         [N, N, N, Y],
  "payroll.manage":       [N, N, N, Y],
  "payments.read":        [Y, Y, Y, Y],
  "payments.write":       [N, Y, Y, Y],
  "payments.edit_closed": [N, N, Y, Y],
  "shift.view_current":   [Y, Y, Y, Y],
  "shift.close":          [N, N, Y, Y],
  "shift.reopen":         [N, N, Y, Y],
  "shift.view_history":   [Y, Y, Y, Y],
  "payouts.view_own":     [Y, Y, Y, Y],
  "payouts.view_all":     [Y, Y, Y, Y],
  "payouts.configure":    [N, N, Y, Y],
  "payouts.adjust":       [N, N, Y, Y],
  "payouts.confirm":      [N, N, Y, Y],
  "payouts.mark_paid":    [N, N, Y, Y],
  "expenses.read":        [Y, Y, Y, Y],
  "expenses.write":       [N, N, Y, Y],
  "reports.finance":      [N, N, N, Y],
  "exports.finance":      [N, N, N, Y],
  "finance.settings":     [N, N, Y, Y],
};

describe("the role matrix", () => {
  it.each(APP_ROLES.map((role, column) => [role, column] as const))(
    "grants %s exactly the approved permissions",
    (role, column) => {
      const granted = rolePermissions(role);
      for (const permission of PERMISSIONS) {
        expect(granted.includes(permission), `${role} × ${permission}`).toBe(
          ROLE_MATRIX[permission][column],
        );
      }
    },
  );

  it("grants nothing outside the permission list", () => {
    for (const role of APP_ROLES) {
      for (const permission of rolePermissions(role)) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it("names every permission once", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("gives the owner everything", () => {
    expect([...rolePermissions("OWNER")].sort()).toEqual([...PERMISSIONS].sort());
  });
});

describe("the owner's switch letting FINANCE edit payout schemes", () => {
  const on = { financeCanEditPayoutSchemes: true };
  const off = { financeCanEditPayoutSchemes: false };

  it("adds payouts.configure for FINANCE only while it is on", () => {
    expect(rolePermissions("FINANCE", off)).not.toContain("payouts.configure");
    expect(rolePermissions("FINANCE", on)).toContain("payouts.configure");
  });

  it("changes nothing for any other role", () => {
    for (const role of APP_ROLES.filter((r) => r !== "FINANCE")) {
      expect(rolePermissions(role, on)).toEqual(rolePermissions(role, off));
    }
  });
});

describe("plan gates", () => {
  it.each(PLANS.map((plan, column) => [plan, column] as const))(
    "the %s plan includes exactly the approved permissions",
    (plan, column) => {
      for (const permission of PERMISSIONS) {
        expect(planIncludes(plan, permission), `${plan} × ${permission}`).toBe(
          PLAN_MATRIX[permission][column],
        );
      }
    },
  );

  it("keeps finance history readable on every plan, so a downgrade hides nothing recorded", () => {
    const reads: Permission[] = [
      "payments.read",
      "shift.view_current",
      "shift.view_history",
      "payouts.view_own",
      "payouts.view_all",
      "expenses.read",
    ];
    for (const plan of PLANS) {
      for (const permission of reads) expect(planIncludes(plan, permission)).toBe(true);
    }
  });
});

describe("can", () => {
  it("is the role and the plan together, for every role × permission × plan", () => {
    APP_ROLES.forEach((role, roleColumn) => {
      PLANS.forEach((plan, planColumn) => {
        const subject = { permissions: rolePermissions(role), plan };
        for (const permission of PERMISSIONS) {
          expect(can(subject, permission), `${role} × ${permission} × ${plan}`).toBe(
            ROLE_MATRIX[permission][roleColumn] && PLAN_MATRIX[permission][planColumn],
          );
        }
      });
    });
  });

  it("refuses what the plan includes but the role lacks", () => {
    expect(can({ permissions: rolePermissions("MASTER"), plan: "PRO" }, "reports.finance")).toBe(
      false,
    );
  });

  it("refuses what the role holds but the plan lacks", () => {
    const owner = rolePermissions("OWNER");
    expect(hasPermission({ permissions: owner }, "reports.finance")).toBe(true);
    expect(can({ permissions: owner, plan: "BASIC" }, "reports.finance")).toBe(false);
  });
});

describe("appRoleOf", () => {
  it("reads the stored STAFF value as MASTER, so no existing login changes", () => {
    expect(appRoleOf("STAFF")).toBe("MASTER");
    expect(appRoleOf("OWNER")).toBe("OWNER");
  });
});

describe("role traits", () => {
  it("narrows only a master to their own rows", () => {
    expect(APP_ROLES.filter((role) => seesOnlyOwnRows(role))).toEqual(["MASTER"]);
  });

  it("lets the owner and finance follow the branch switcher, and pins reception and masters", () => {
    expect(APP_ROLES.filter((role) => spansAllBranches(role))).toEqual(["OWNER", "FINANCE"]);
  });

  it("ties only a master's login to an employee", () => {
    expect(APP_ROLES.filter((role) => isEmployeeLogin(role))).toEqual(["MASTER"]);
  });
});

describe("sections", () => {
  const sections = Object.keys(SECTION_PERMISSIONS);

  it("names the sections that need a permission", () => {
    // Guards against a section being quietly dropped from the table.
    expect(sections).toEqual([
      "/dashboard/clients",
      "/dashboard/services",
      "/dashboard/workers",
      "/dashboard/analytics",
      "/dashboard/payroll",
      "/dashboard/settings",
      "/dashboard/billing",
    ]);
  });

  it("covers a section's sub-routes", () => {
    expect(sectionPermission("/dashboard/clients/3f2b9c11-6a4d-4e0b-9c1f-2d7e5a8b4c60")).toBe(
      "clients.read",
    );
  });

  it("does not match a path that merely shares a prefix", () => {
    // A plain startsWith() would have swallowed these.
    expect(sectionPermission("/dashboard/clientsx")).toBeNull();
    expect(sectionPermission("/dashboard/settings-export")).toBeNull();
  });

  it("leaves Today and Calendar open to every role", () => {
    for (const role of APP_ROLES) {
      expect(canOpenSection(rolePermissions(role), "/dashboard")).toBe(true);
      expect(canOpenSection(rolePermissions(role), "/dashboard/calendar")).toBe(true);
    }
  });

  it("keeps a master out of every section, sub-routes such as a client profile included", () => {
    const master = rolePermissions("MASTER");
    for (const section of sections) {
      expect(canOpenSection(master, section), section).toBe(false);
      expect(canOpenSection(master, `${section}/whatever`), section).toBe(false);
    }
  });

  it("opens every section to the owner", () => {
    for (const section of sections) {
      expect(canOpenSection(rolePermissions("OWNER"), section)).toBe(true);
    }
  });

  it("opens nothing to a blocked login, which carries no permissions", () => {
    for (const section of sections) expect(canOpenSection([], section)).toBe(false);
  });

  it("opens reception the clients and the schedule, nothing with prices, staff or money", () => {
    const admin = rolePermissions("ADMIN");
    expect(sections.filter((s) => canOpenSection(admin, s))).toEqual([
      "/dashboard/clients",
      "/dashboard/workers",
    ]);
  });

  it("opens finance the clients, the schedule and analytics", () => {
    const finance = rolePermissions("FINANCE");
    expect(sections.filter((s) => canOpenSection(finance, s))).toEqual([
      "/dashboard/clients",
      "/dashboard/workers",
      "/dashboard/analytics",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import { Plan } from "@prisma/client";
import { PLAN_FEATURES } from "../plans";
import {
  APP_ROLES,
  PERMISSIONS,
  SECTION_PERMISSIONS,
  TEAM_ROLES,
  accessRefusal,
  appRoleOf,
  can,
  canAssignRole,
  canOpenSection,
  canUpgradePlan,
  hasPermission,
  isEmployeeLogin,
  isTeamRole,
  planIncludes,
  roleOnPlan,
  rolePermissions,
  sectionPermission,
  seesOnlyOwnRows,
  spansAllBranches,
  type AppRole,
  type Permission,
} from "./permissions";

// The permission matrix approved for the finance module, written out cell by
// cell. It is a second copy of ROLE_PERMISSIONS on purpose, not an import of it:
// changing who may do what takes an edit here as well as in permissions.ts, or
// this suite fails.
//
// Each table's columns are named below, and every cell is read back by that
// name. Nothing here depends on the order of APP_ROLES or of the Plan enum; the
// first tests check that the named columns are exactly the roles and plans that
// exist, so a new role or plan cannot slip in without a column.

const Y = true;
const N = false;

const ROLE_COLUMNS = ["OWNER", "ADMIN", "FINANCE", "MASTER"] as const satisfies readonly AppRole[];
const PLAN_COLUMNS = ["FREE", "START", "BASIC", "PRO"] as const satisfies readonly Plan[];

type Row<K extends string> = Record<K, boolean>;
const byRole = (cells: readonly [boolean, boolean, boolean, boolean]): Row<AppRole> =>
  Object.fromEntries(ROLE_COLUMNS.map((role, i) => [role, cells[i]])) as Row<AppRole>;
const byPlan = (cells: readonly [boolean, boolean, boolean, boolean]): Row<Plan> =>
  Object.fromEntries(PLAN_COLUMNS.map((plan, i) => [plan, cells[i]])) as Row<Plan>;

// The plans that exist, from the database enum itself.
const PLANS: readonly Plan[] = Object.values(Plan);

//                                          OWNER ADMIN FINANCE MASTER
// prettier-ignore
const ROLE_MATRIX: Record<Permission, Row<AppRole>> = {
  "bookings.read":        byRole([Y, Y, Y, Y]),
  "bookings.write":       byRole([Y, Y, N, Y]),
  "clients.read":         byRole([Y, Y, Y, N]),
  "clients.write":        byRole([Y, Y, N, N]),
  "clients.delete":       byRole([Y, N, N, N]),
  "schedule.read":        byRole([Y, Y, Y, N]),
  "schedule.write":       byRole([Y, Y, N, N]),
  "services.write":       byRole([Y, N, N, N]),
  "staff.manage":         byRole([Y, N, N, N]),
  "roles.assign":         byRole([Y, N, N, N]),
  "settings.write":       byRole([Y, N, N, N]),
  "billing.manage":       byRole([Y, N, N, N]),
  "analytics.view":       byRole([Y, N, Y, N]),
  "exports.data":         byRole([Y, N, Y, N]),
  "payroll.manage":       byRole([Y, N, N, N]),
  "payments.read":        byRole([Y, Y, Y, N]),
  "payments.write":       byRole([Y, Y, N, N]),
  "payments.edit_closed": byRole([Y, N, N, N]),
  "shift.view_current":   byRole([Y, Y, Y, N]),
  "shift.close":          byRole([Y, Y, N, N]),
  "shift.reopen":         byRole([Y, N, N, N]),
  "shift.view_history":   byRole([Y, N, Y, N]),
  "payouts.view_own":     byRole([Y, Y, Y, Y]),
  "payouts.view_all":     byRole([Y, N, Y, N]),
  "payouts.configure":    byRole([Y, N, N, N]), // FINANCE only through the owner's switch
  "payouts.adjust":       byRole([Y, N, Y, N]),
  "payouts.confirm":      byRole([Y, N, Y, N]),
  "payouts.mark_paid":    byRole([Y, N, Y, N]),
  "expenses.read":        byRole([Y, N, Y, N]),
  "expenses.write":       byRole([Y, N, Y, N]),
  "reports.finance":      byRole([Y, N, Y, N]),
  "exports.finance":      byRole([Y, N, Y, N]),
  "finance.settings":     byRole([Y, N, N, N]),
};

// Start = payments only; Salon (BASIC) = + shift close, payouts, expenses;
// Pro = + finance reports and exports. Handing out logins needs a paid plan.
// Reads are on every plan.
//                                          FREE START BASIC PRO
// prettier-ignore
const PLAN_MATRIX: Record<Permission, Row<Plan>> = {
  "bookings.read":        byPlan([Y, Y, Y, Y]),
  "bookings.write":       byPlan([Y, Y, Y, Y]),
  "clients.read":         byPlan([Y, Y, Y, Y]),
  "clients.write":        byPlan([Y, Y, Y, Y]),
  "clients.delete":       byPlan([Y, Y, Y, Y]),
  "schedule.read":        byPlan([Y, Y, Y, Y]),
  "schedule.write":       byPlan([Y, Y, Y, Y]),
  "services.write":       byPlan([Y, Y, Y, Y]),
  "staff.manage":         byPlan([Y, Y, Y, Y]),
  "roles.assign":         byPlan([N, Y, Y, Y]),
  "settings.write":       byPlan([Y, Y, Y, Y]),
  "billing.manage":       byPlan([Y, Y, Y, Y]),
  "analytics.view":       byPlan([Y, Y, Y, Y]),
  "exports.data":         byPlan([N, N, N, Y]),
  "payroll.manage":       byPlan([N, N, N, Y]),
  "payments.read":        byPlan([Y, Y, Y, Y]),
  "payments.write":       byPlan([N, Y, Y, Y]),
  "payments.edit_closed": byPlan([N, N, Y, Y]),
  "shift.view_current":   byPlan([Y, Y, Y, Y]),
  "shift.close":          byPlan([N, N, Y, Y]),
  "shift.reopen":         byPlan([N, N, Y, Y]),
  "shift.view_history":   byPlan([Y, Y, Y, Y]),
  "payouts.view_own":     byPlan([Y, Y, Y, Y]),
  "payouts.view_all":     byPlan([Y, Y, Y, Y]),
  "payouts.configure":    byPlan([N, N, Y, Y]),
  "payouts.adjust":       byPlan([N, N, Y, Y]),
  "payouts.confirm":      byPlan([N, N, Y, Y]),
  "payouts.mark_paid":    byPlan([N, N, Y, Y]),
  "expenses.read":        byPlan([Y, Y, Y, Y]),
  "expenses.write":       byPlan([N, N, Y, Y]),
  "reports.finance":      byPlan([N, N, N, Y]),
  "exports.finance":      byPlan([N, N, N, Y]),
  "finance.settings":     byPlan([N, N, Y, Y]),
};

// Which plans carry logins of each role: staff and reception on every paid plan,
// finance on Pro. The owner's own login needs no plan.
//                                        FREE START BASIC PRO
const ROLE_PLAN_MATRIX: Record<AppRole, Row<Plan>> = {
  OWNER: byPlan([Y, Y, Y, Y]),
  ADMIN: byPlan([N, Y, Y, Y]),
  FINANCE: byPlan([N, N, N, Y]),
  MASTER: byPlan([N, Y, Y, Y]),
};

const sorted = <T extends string>(values: readonly T[]) => [...values].sort();

describe("the matrices' columns", () => {
  it("name every role, and nothing else", () => {
    expect(sorted(ROLE_COLUMNS)).toEqual(sorted(APP_ROLES));
    expect(sorted(Object.keys(ROLE_PLAN_MATRIX))).toEqual(sorted(APP_ROLES));
  });

  it("name every plan of the Prisma enum, which PLAN_FEATURES also covers exactly", () => {
    expect(sorted(PLAN_COLUMNS)).toEqual(sorted(PLANS));
    expect(sorted(Object.keys(PLAN_FEATURES))).toEqual(sorted(PLANS));
  });

  it("have a row for every permission", () => {
    expect(sorted(Object.keys(ROLE_MATRIX))).toEqual(sorted(PERMISSIONS));
    expect(sorted(Object.keys(PLAN_MATRIX))).toEqual(sorted(PERMISSIONS));
  });
});

describe("the role matrix", () => {
  it.each(APP_ROLES)("grants %s exactly the approved permissions", (role) => {
    const granted = rolePermissions(role);
    for (const permission of PERMISSIONS) {
      expect(granted.includes(permission), `${role} × ${permission}`).toBe(
        ROLE_MATRIX[permission][role],
      );
    }
  });

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
    expect(sorted(rolePermissions("OWNER"))).toEqual(sorted(PERMISSIONS));
  });

  it("gives every role bookings.read, which Today asks for — a refused page sends a role there", () => {
    // A role without it would be redirected from Today back to Today.
    for (const role of APP_ROLES) expect(rolePermissions(role), role).toContain("bookings.read");
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

  it("still follows the plan once it is on, on every plan, and widens nothing else", () => {
    for (const plan of PLANS) {
      const finance = { permissions: rolePermissions("FINANCE", on), plan };
      for (const permission of PERMISSIONS) {
        const roleHolds = permission === "payouts.configure" || ROLE_MATRIX[permission].FINANCE;
        expect(can(finance, permission), `FINANCE (switch on) × ${permission} × ${plan}`).toBe(
          roleHolds && PLAN_MATRIX[permission][plan],
        );
      }
    }
  });
});

describe("plan gates", () => {
  it.each(PLANS)("the %s plan includes exactly the approved permissions", (plan) => {
    for (const permission of PERMISSIONS) {
      expect(planIncludes(plan, permission), `${plan} × ${permission}`).toBe(
        PLAN_MATRIX[permission][plan],
      );
    }
  });

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

  it("never gates switching a login off, so a lapsed account can still close one", () => {
    for (const plan of PLANS) expect(planIncludes(plan, "staff.manage")).toBe(true);
  });
});

describe("can and accessRefusal", () => {
  it("is the role and the plan together, for every role × permission × plan", () => {
    for (const role of APP_ROLES) {
      for (const plan of PLANS) {
        const subject = { permissions: rolePermissions(role), plan };
        for (const permission of PERMISSIONS) {
          expect(can(subject, permission), `${role} × ${permission} × ${plan}`).toBe(
            ROLE_MATRIX[permission][role] && PLAN_MATRIX[permission][plan],
          );
        }
      }
    }
  });

  it("refuses a blocked login — no permissions — everything, on every plan, by role", () => {
    for (const plan of PLANS) {
      const blocked = { permissions: [] as Permission[], plan };
      for (const permission of PERMISSIONS) {
        expect(hasPermission(blocked, permission), `${permission} × ${plan}`).toBe(false);
        expect(can(blocked, permission), `${permission} × ${plan}`).toBe(false);
        expect(accessRefusal(blocked, [permission])).toBe("role");
      }
    }
  });

  it("names the role before the plan, so a role that could never do it sees no upgrade card", () => {
    expect(accessRefusal({ permissions: rolePermissions("MASTER"), plan: "FREE" }, ["payroll.manage"])).toBe("role");
    expect(accessRefusal({ permissions: rolePermissions("OWNER"), plan: "BASIC" }, ["reports.finance"])).toBe("plan");
    expect(accessRefusal({ permissions: rolePermissions("OWNER"), plan: "PRO" }, ["reports.finance"])).toBeNull();
  });

  it("refuses a set of permissions when any one of them fails", () => {
    const clientsExport = ["clients.read", "exports.data"] as const;
    expect(accessRefusal({ permissions: rolePermissions("FINANCE"), plan: "PRO" }, clientsExport)).toBeNull();
    // Reception reads clients but may not export: refused by role, even on Pro.
    expect(accessRefusal({ permissions: rolePermissions("ADMIN"), plan: "PRO" }, clientsExport)).toBe("role");
    expect(accessRefusal({ permissions: rolePermissions("OWNER"), plan: "BASIC" }, clientsExport)).toBe("plan");
  });

  it("offers an upgrade only to the owner; every other role is told to ask the owner", () => {
    expect(APP_ROLES.filter((role) => canUpgradePlan({ permissions: rolePermissions(role) }))).toEqual([
      "OWNER",
    ]);
    expect(canUpgradePlan({ permissions: [] })).toBe(false);
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

describe("logins by plan", () => {
  it.each(APP_ROLES)("%s logins are on exactly the approved plans", (role) => {
    for (const plan of PLANS) {
      expect(roleOnPlan(role, plan), `${role} × ${plan}`).toBe(ROLE_PLAN_MATRIX[role][plan]);
    }
  });

  it("lets the owner create a login only for a role the plan includes", () => {
    const assignable = (plan: Plan) =>
      (["ADMIN", "FINANCE", "MASTER"] as const).filter((role) =>
        canAssignRole({ permissions: rolePermissions("OWNER"), plan }, role),
      );
    expect(assignable("FREE")).toEqual([]);
    expect(assignable("START")).toEqual(["ADMIN", "MASTER"]);
    expect(assignable("BASIC")).toEqual(["ADMIN", "MASTER"]);
    expect(assignable("PRO")).toEqual(["ADMIN", "FINANCE", "MASTER"]);
  });

  it("lets no other role create a login of any kind, on any plan", () => {
    for (const role of APP_ROLES.filter((r) => r !== "OWNER")) {
      for (const plan of PLANS) {
        for (const target of ["ADMIN", "FINANCE", "MASTER"] as const) {
          expect(
            canAssignRole({ permissions: rolePermissions(role), plan }, target),
            `${role} → ${target} × ${plan}`,
          ).toBe(false);
        }
      }
    }
  });
});

describe("appRoleOf", () => {
  it("reads the stored STAFF value as MASTER, so no existing login changes", () => {
    expect(appRoleOf("STAFF")).toBe("MASTER");
    expect(appRoleOf("OWNER")).toBe("OWNER");
  });

  it("maps each stored team role to the role of the same name", () => {
    for (const role of TEAM_ROLES) expect(appRoleOf(role)).toBe(role);
  });

  it("returns null for a value it does not know, so the login fails closed", () => {
    // "MASTER" is the name in code, never a stored value.
    for (const value of ["RECEPTION", "owner", "", "MASTER"]) {
      expect(appRoleOf(value), JSON.stringify(value)).toBeNull();
    }
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

  it("calls reception and finance the team roles", () => {
    expect(APP_ROLES.filter((role) => isTeamRole(role))).toEqual(["ADMIN", "FINANCE"]);
  });
});

describe("sections", () => {
  const sections = Object.keys(SECTION_PERMISSIONS);
  const openTo = (role: AppRole) => sections.filter((s) => canOpenSection(rolePermissions(role), s));

  it("names the sections that need a permission", () => {
    // Guards against a section being quietly dropped from the table.
    expect(sections).toEqual([
      "/dashboard/clients",
      "/dashboard/services",
      "/dashboard/workers",
      "/dashboard/time-off",
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
    expect(openTo("OWNER")).toEqual(sections);
  });

  it("opens nothing to a blocked login, which carries no permissions", () => {
    for (const section of sections) expect(canOpenSection([], section)).toBe(false);
  });

  it("keeps staff management — phones, login emails, login controls — to the owner", () => {
    expect(APP_ROLES.filter((role) => canOpenSection(rolePermissions(role), "/dashboard/workers"))).toEqual([
      "OWNER",
    ]);
  });

  it("opens reception the clients and time off, nothing with prices, staff or money", () => {
    expect(openTo("ADMIN")).toEqual(["/dashboard/clients", "/dashboard/time-off"]);
  });

  it("opens finance the clients, time off and analytics", () => {
    expect(openTo("FINANCE")).toEqual([
      "/dashboard/clients",
      "/dashboard/time-off",
      "/dashboard/analytics",
    ]);
  });
});

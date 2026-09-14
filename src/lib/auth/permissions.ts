// Who may do what in a salon, as permission keys.
//
// Server actions, route handlers and pages ask for a permission —
// requirePermission("services.write") — never for a role. This file is the only
// place that knows which role holds which permission, so adding a role (or, one
// day, letting a salon define its own) changes the tables below and nothing
// else. guard-coverage.test.ts fails if a role-name comparison appears anywhere
// outside this file.
//
// Two questions, answered together:
//   may this ROLE do it?       rolePermissions(), carried on the session
//   does the PLAN include it?  planIncludes(), which reads the same
//                              PLAN_FEATURES every existing gate reads
// accessRefusal() asks both and says which one refused, because a page needs to
// know: a role without the permission is sent back to its own day, a plan without
// it gets the upgrade card. can() is the yes/no. The guards in ./guards use
// them, so a plan-gated permission is never checked by hand.
//
// PURE, like ./access: no cookies, no Prisma client, no next/headers.

import type { Plan, Role } from "@prisma/client";
import { featuresFor, type PlanFeatures } from "../plans";

/** The roles the product talks about. */
export const APP_ROLES = ["OWNER", "ADMIN", "FINANCE", "MASTER"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * The product role behind a stored Membership.role, or null for a value this
 * code does not know. STAFF stays the stored value for MASTER, so existing logins
 * needed no data rewrite.
 *
 * Takes a string, not Role: the enum can gain a value in the database before the
 * code that maps it is deployed, and such a login must fail closed — getSession()
 * blocks it — rather than reach a permission table with a hole in it.
 */
export function appRoleOf(role: string): AppRole | null {
  switch (role) {
    case "OWNER":
      return "OWNER";
    case "ADMIN":
      return "ADMIN";
    case "FINANCE":
      return "FINANCE";
    case "STAFF":
      return "MASTER";
    default:
      return null;
  }
}

/**
 * The logins the owner hands out besides a master's: reception and finance. They
 * are stored under the same names, have no calendar column and take no staff
 * seat.
 */
export const TEAM_ROLES = ["ADMIN", "FINANCE"] as const satisfies readonly Role[];
export type TeamRole = (typeof TEAM_ROLES)[number];

export function isTeamRole(role: AppRole): role is TeamRole {
  return (TEAM_ROLES as readonly AppRole[]).includes(role);
}

export const PERMISSIONS = [
  // The booking product
  "bookings.read", // calendar, Today, booking details
  "bookings.write", // create, move, change status
  "clients.read", // client list and profile, phone numbers included
  "clients.write", // edit clients and their notes
  "clients.delete", // takes the client's bookings with them
  "schedule.read", // working hours, time off
  "schedule.write",
  "services.write", // catalogue and prices
  "staff.manage", // employees, master logins, switching any login off
  "roles.assign", // ADMIN and FINANCE logins
  "settings.write", // salon profile, booking link, hours, branches
  "billing.manage", // subscription, and accepting revised terms for the account
  "analytics.view",
  "exports.data", // bookings and clients CSV
  "payroll.manage", // the Pro payroll screen, until payout statements replace it
  // Payments and shift
  "payments.read",
  "payments.write", // take, edit, void, refund
  "payments.edit_closed", // change a payment inside a closed shift
  "shift.view_current",
  "shift.close",
  "shift.reopen",
  "shift.view_history",
  // Payouts
  "payouts.view_own",
  "payouts.view_all", // schemes and every statement
  "payouts.configure", // schemes and material costs
  "payouts.adjust", // advance, deduction, bonus
  "payouts.confirm",
  "payouts.mark_paid",
  // Expenses, reports, finance settings
  "expenses.read",
  "expenses.write", // the salon's category list included
  "reports.finance",
  "exports.finance",
  "finance.settings", // payout period, the FINANCE scheme toggle
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * What each role may do, before any salon toggle or plan. The finance
 * permissions have no screens yet; they are granted now so the whole approved
 * matrix is under test before the first finance screen exists.
 */
export const ROLE_PERMISSIONS: Record<AppRole, readonly Permission[]> = {
  OWNER: PERMISSIONS,
  // Reception: the day's bookings, clients and schedule, taking payments and
  // closing the till. No prices, staff, settings, money reports or anyone
  // else's payouts, and only the current shift.
  ADMIN: [
    "bookings.read",
    "bookings.write",
    "clients.read",
    "clients.write",
    "schedule.read",
    "schedule.write",
    "payments.read",
    "payments.write",
    "shift.view_current",
    "shift.close",
    "payouts.view_own",
  ],
  // Every money view, expenses and statements; bookings, clients and schedule
  // read-only.
  FINANCE: [
    "bookings.read",
    "clients.read",
    "schedule.read",
    "analytics.view",
    "exports.data",
    "payments.read",
    "shift.view_current",
    "shift.view_history",
    "payouts.view_own",
    "payouts.view_all",
    "payouts.adjust",
    "payouts.confirm",
    "payouts.mark_paid",
    "expenses.read",
    "expenses.write",
    "reports.finance",
    "exports.finance",
  ],
  // Their own bookings (narrowed to their own rows, see ROLE_TRAITS) and their
  // own payout statement.
  MASTER: ["bookings.read", "bookings.write", "payouts.view_own"],
};

/** Per-salon switches that widen a role. */
export interface SalonPermissionSettings {
  /** The owner lets FINANCE edit payout schemes. Off unless switched on. */
  financeCanEditPayoutSchemes: boolean;
}

const NO_SALON_TOGGLES: SalonPermissionSettings = { financeCanEditPayoutSchemes: false };

/** Everything `role` may do in a salon with these settings. */
export function rolePermissions(
  role: AppRole,
  salon: SalonPermissionSettings = NO_SALON_TOGGLES,
): Permission[] {
  const granted = [...ROLE_PERMISSIONS[role]];
  if (role === "FINANCE" && salon.financeCanEditPayoutSchemes) {
    granted.push("payouts.configure");
  }
  return granted;
}

/**
 * The plan feature a permission needs; a permission not listed is on every plan.
 * Reads stay ungated on purpose: a salon that downgrades keeps its finance
 * history readable, it just can't add to it. Switching a login off (staff.manage)
 * stays ungated too, so an account that lapsed can still take access away.
 */
export const PERMISSION_PLAN_FEATURE: Partial<Record<Permission, keyof PlanFeatures>> = {
  "roles.assign": "staffRoles",
  "exports.data": "exports",
  "payroll.manage": "payroll",
  "payments.write": "payments",
  "payments.edit_closed": "shiftClose",
  "shift.close": "shiftClose",
  "shift.reopen": "shiftClose",
  "payouts.configure": "payoutStatements",
  "payouts.adjust": "payoutStatements",
  "payouts.confirm": "payoutStatements",
  "payouts.mark_paid": "payoutStatements",
  "finance.settings": "payoutStatements",
  "expenses.write": "expenses",
  "reports.finance": "financeReports",
  "exports.finance": "financeReports",
};

/** Does `plan` include what `permission` does? */
export function planIncludes(plan: Plan, permission: Permission): boolean {
  const feature = PERMISSION_PLAN_FEATURE[permission];
  return feature === undefined || featuresFor(plan)[feature];
}

/** Does the session's role hold `permission`? Says nothing about the plan. */
export function hasPermission(
  subject: { permissions: readonly Permission[] },
  permission: Permission,
): boolean {
  return subject.permissions.includes(permission);
}

/** Which question refused: the role's, or — only once the role passed — the plan's. */
export type Refusal = "role" | "plan";

/**
 * Why `subject` may not do all of `permissions`, or null when it may. The role is
 * asked first, so a role that could never do it is not shown an upgrade card.
 */
export function accessRefusal(
  subject: { permissions: readonly Permission[]; plan: Plan },
  permissions: readonly Permission[],
): Refusal | null {
  if (!permissions.every((p) => hasPermission(subject, p))) return "role";
  if (!permissions.every((p) => planIncludes(subject.plan, p))) return "plan";
  return null;
}

/**
 * May this role change the plan when one is missing? Only billing.manage (the
 * owner) can act on an upgrade card; anyone else is told to ask the owner.
 */
export function canUpgradePlan(subject: { permissions: readonly Permission[] }): boolean {
  return hasPermission(subject, "billing.manage");
}

/** The role holds it AND the plan includes it. */
export function can(
  subject: { permissions: readonly Permission[]; plan: Plan },
  permission: Permission,
): boolean {
  return accessRefusal(subject, [permission]) === null;
}

/**
 * The plan feature a login of each role needs, or null for none. A login whose
 * plan lacks it is closed on the next request (see staffBlockedReason): staff,
 * reception and finance logins all stop when the account lapses to FREE, and
 * finance logins are Pro.
 */
export const ROLE_PLAN_FEATURE: Record<AppRole, keyof PlanFeatures | null> = {
  OWNER: null,
  ADMIN: "staffRoles",
  FINANCE: "financeLogins",
  MASTER: "staffRoles",
};

/** Does `plan` include logins of this role? */
export function roleOnPlan(role: AppRole, plan: Plan): boolean {
  const feature = ROLE_PLAN_FEATURE[role];
  return feature === null || featuresFor(plan)[feature];
}

/** The roles a login can be created for, and the permission that creates each. */
const ASSIGN_PERMISSION = {
  ADMIN: "roles.assign",
  FINANCE: "roles.assign",
  MASTER: "staff.manage",
} as const satisfies Record<Exclude<AppRole, "OWNER">, Permission>;
export type AssignableRole = keyof typeof ASSIGN_PERMISSION;

/**
 * May `subject` create (or re-open) a login of this role? Its permission, on its
 * plan, and a plan that includes the role itself: a Salon-plan owner may hand out
 * reception logins but not finance ones.
 */
export function canAssignRole(
  subject: { permissions: readonly Permission[]; plan: Plan },
  role: AssignableRole,
): boolean {
  return can(subject, ASSIGN_PERMISSION[role]) && roleOnPlan(role, subject.plan);
}

interface RoleTraits {
  /** "own": booking queries are narrowed to the login's employee. */
  rows: "salon" | "own";
  /** "account": follows the Pro branch switcher; "branch": pinned to its salon. */
  branches: "account" | "branch";
  /** The login IS an employee: it needs one, and closes when they are deactivated. */
  employeeLogin: boolean;
}

/** How far each role reaches, as opposed to what it may do. */
export const ROLE_TRAITS: Record<AppRole, RoleTraits> = {
  OWNER: { rows: "salon", branches: "account", employeeLogin: false },
  ADMIN: { rows: "salon", branches: "branch", employeeLogin: false },
  FINANCE: { rows: "salon", branches: "account", employeeLogin: false },
  MASTER: { rows: "own", branches: "branch", employeeLogin: true },
};

export function seesOnlyOwnRows(role: AppRole): boolean {
  return ROLE_TRAITS[role].rows === "own";
}

export function spansAllBranches(role: AppRole): boolean {
  return ROLE_TRAITS[role].branches === "account";
}

export function isEmployeeLogin(role: AppRole): boolean {
  return ROLE_TRAITS[role].employeeLogin;
}

/**
 * The permission each dashboard section needs. One table for the navigation and
 * the page gates both, so a screen cannot be listed but refused, or reachable
 * but hidden — guard-coverage.test.ts checks every page against it. Sections not
 * listed (Today, Calendar) need only bookings.read, which every role holds; the
 * platform admin panel checks its own flag.
 */
export const SECTION_PERMISSIONS = {
  "/dashboard/clients": "clients.read",
  "/dashboard/services": "services.write",
  // Staff management: phones, login emails, and the controls that create and
  // close logins.
  "/dashboard/workers": "staff.manage",
  // Time off on its own, for roles that plan the schedule without managing staff.
  "/dashboard/time-off": "schedule.read",
  "/dashboard/analytics": "analytics.view",
  "/dashboard/payroll": "payroll.manage",
  "/dashboard/settings": "settings.write",
  "/dashboard/billing": "billing.manage",
} as const satisfies Record<string, Permission>;

/**
 * The permission `pathname` needs, or null when none does. Matched by section
 * and sub-route, locale prefix already stripped: "/dashboard/clientsx" is not
 * "/dashboard/clients".
 */
export function sectionPermission(pathname: string): Permission | null {
  for (const [section, permission] of Object.entries(SECTION_PERMISSIONS)) {
    if (pathname === section || pathname.startsWith(`${section}/`)) return permission;
  }
  return null;
}

/** May a role holding `permissions` open `pathname`? */
export function canOpenSection(permissions: readonly Permission[], pathname: string): boolean {
  const needed = sectionPermission(pathname);
  return needed === null || permissions.includes(needed);
}

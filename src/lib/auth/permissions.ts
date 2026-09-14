// Who may do what in a salon, as permission keys.
//
// Server actions, route handlers and pages ask for a permission —
// requirePermission("services.write") — never for a role. This file is the only
// place that knows which role holds which permission, so adding a role (or, one
// day, letting a salon define its own) changes the tables below and nothing
// else. guard-coverage.test.ts fails if a role-name comparison appears anywhere
// outside this file.
//
// Two questions stay apart:
//   may this ROLE do it?       rolePermissions(), carried on the session
//   does the PLAN include it?  planIncludes(), which reads the same
//                              PLAN_FEATURES every existing gate reads
// A page needs the answers separately: a role without the permission is sent
// back to its own day, a plan without it gets the upgrade card. can() is both.
//
// PURE, like ./access: no cookies, no Prisma client, no next/headers.

import type { Plan, Role } from "@prisma/client";
import { featuresFor, type PlanFeatures } from "../plans";

/** The roles the product talks about. */
export const APP_ROLES = ["OWNER", "ADMIN", "FINANCE", "MASTER"] as const;
export type AppRole = (typeof APP_ROLES)[number];

/**
 * The product role behind a stored Membership.role. STAFF stays the stored value
 * for MASTER, so existing logins need no data rewrite. When ADMIN and FINANCE
 * join the database enum this switch stops compiling until they are mapped.
 */
export function appRoleOf(role: Role): AppRole {
  switch (role) {
    case "OWNER":
      return "OWNER";
    case "STAFF":
      return "MASTER";
  }
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
  "staff.manage", // employees and master logins
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
 * history readable, it just can't add to it.
 */
export const PERMISSION_PLAN_FEATURE: Partial<Record<Permission, keyof PlanFeatures>> = {
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

/** Does the session's role hold `permission`? The one way to ask. */
export function hasPermission(
  subject: { permissions: readonly Permission[] },
  permission: Permission,
): boolean {
  return subject.permissions.includes(permission);
}

/** The role holds it AND the plan includes it. */
export function can(
  subject: { permissions: readonly Permission[]; plan: Plan },
  permission: Permission,
): boolean {
  return hasPermission(subject, permission) && planIncludes(subject.plan, permission);
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
 * listed (Today, Calendar) are open to every role; the platform admin panel
 * checks its own flag.
 */
export const SECTION_PERMISSIONS = {
  "/dashboard/clients": "clients.read",
  "/dashboard/services": "services.write",
  "/dashboard/workers": "schedule.read",
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

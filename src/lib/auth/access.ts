// What a signed-in user of a salon is allowed to see and touch.
//
// Two roles share one dashboard:
//   OWNER — the paying account. Sees the whole salon.
//   STAFF — a single master's own login (Membership.employeeId). Sees their own
//           column of the calendar and nothing else.
//
// Everything here is PURE: no cookies, no Prisma, no next/headers. The async
// wrappers that read the session live in ./guards. Keeping the decisions pure is
// what lets the staff-isolation tests cover them without a database.

import type { Role } from "@prisma/client";

/**
 * The tenant + row scope a request runs under.
 *
 * `employeeId` is the whole point: null means "the entire salon" (owner), a
 * value means "only this master's rows". Passing it into a Prisma `where`
 * alongside `salonId` is how a master is confined — never by filtering in JS
 * after the fact, which leaks the moment someone forgets.
 */
export interface SalonScope {
  salonId: string;
  employeeId: string | null;
}

/** True when the scope belongs to a master's own login rather than the owner. */
export function isStaffScope(scope: SalonScope): boolean {
  return scope.employeeId !== null;
}

/**
 * Prisma `where` fragment selecting the appointments a scope may read or write:
 * the salon's, narrowed to one employee for a master.
 *
 * Spread it into a filter — `where: { id, ...appointmentScope(scope) }` — so the
 * tenant guard and the row guard are always applied together.
 */
export function appointmentScope(scope: SalonScope): {
  salonId: string;
  employeeId?: string;
} {
  return scope.employeeId === null
    ? { salonId: scope.salonId }
    : { salonId: scope.salonId, employeeId: scope.employeeId };
}

/**
 * May this scope create or move work for `employeeId`? An owner books for
 * anyone; a master books only for themselves. Call it before trusting an
 * employeeId that arrived in a request body.
 */
export function canActForEmployee(scope: SalonScope, employeeId: string): boolean {
  return scope.employeeId === null || scope.employeeId === employeeId;
}

/**
 * Dashboard sections a master never gets: the salon's whole client base, the
 * service catalogue and prices, other masters' records, revenue, payroll,
 * salon settings and billing.
 *
 * Single source of truth for BOTH the navigation and the page guards, so a new
 * owner-only screen cannot end up hidden-but-reachable (or guarded-but-listed).
 * Matched by prefix, locale prefix already stripped.
 */
export const OWNER_ONLY_SECTIONS = [
  "/dashboard/clients",
  "/dashboard/services",
  "/dashboard/workers",
  "/dashboard/analytics",
  "/dashboard/payroll",
  "/dashboard/settings",
  "/dashboard/billing",
  "/dashboard/admin",
] as const;

/** True when `pathname` falls inside a section only the owner may open. */
export function isOwnerOnlySection(pathname: string): boolean {
  return OWNER_ONLY_SECTIONS.some(
    (s) => pathname === s || pathname.startsWith(`${s}/`),
  );
}

/**
 * Can a user with this role open this path? Admins are handled separately (they
 * have no salon at all), so this only answers the OWNER/STAFF question.
 */
export function canOpenSection(role: Role | null, pathname: string): boolean {
  if (role === "STAFF") return !isOwnerOnlySection(pathname);
  return true;
}

/**
 * Why a master's login stops working. Re-derived on EVERY request, so revoking
 * access is immediate: no claim cached in the session cookie can outlive it.
 *   plan     — the account fell to a tier without staffRoles (lapsed trial,
 *              missed payment). Staff logins are a paid feature.
 *   inactive — the owner deactivated the master, or their employee record is
 *              gone. Deactivating someone is how a salon says "not any more",
 *              and it has to close the login too, not just the calendar column.
 */
export type StaffBlockedReason = "plan" | "inactive";

export function staffBlockedReason(opts: {
  isStaff: boolean;
  staffRolesEnabled: boolean;
  /** Employee.isActive; null/undefined when the record no longer resolves. */
  employeeIsActive: boolean | null | undefined;
}): StaffBlockedReason | null {
  if (!opts.isStaff) return null;
  if (!opts.staffRolesEnabled) return "plan";
  // Anything other than an explicit `true` — false, null, a membership whose
  // employee was deleted — closes the login. Fail closed, not open.
  return opts.employeeIsActive === true ? null : "inactive";
}

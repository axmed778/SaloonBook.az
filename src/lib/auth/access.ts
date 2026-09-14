// Row scope: which of a salon's rows a signed-in role may read and touch.
//
// WHAT a role may do lives in ./permissions. This file answers the narrower
// question every bookings query asks — the whole salon, or only the login's own
// employee — plus the rule that closes an employee's login.
//
// Everything here is PURE: no cookies, no Prisma, no next/headers. The async
// wrappers that read the session live in ./guards. Keeping the decisions pure is
// what lets the staff-isolation tests cover them without a database.

import { seesOnlyOwnRows, type AppRole } from "./permissions";

/**
 * The tenant + row scope a request runs under.
 *
 * `employeeId` is the whole point: null means "the entire salon", a value means
 * "only this master's rows". Passing it into a Prisma `where` alongside
 * `salonId` is how a master is confined — never by filtering in JS after the
 * fact, which leaks the moment someone forgets.
 */
export interface SalonScope {
  salonId: string;
  employeeId: string | null;
}

/** True when the scope belongs to a master's own login rather than the salon. */
export function isStaffScope(scope: SalonScope): boolean {
  return scope.employeeId !== null;
}

/**
 * The scope a session's booking queries run under: the whole salon, or — for a
 * role that sees only its own rows — the login's employee. Null when there is no
 * role, or when such a login has no employee to narrow to: treating that as "the
 * whole salon" would silently widen a master to owner reach.
 */
export function salonScopeFor(session: {
  salonId: string;
  appRole: AppRole | null;
  employeeId: string | null;
}): SalonScope | null {
  if (session.appRole === null) return null;
  if (!seesOnlyOwnRows(session.appRole)) return { salonId: session.salonId, employeeId: null };
  return session.employeeId ? { salonId: session.salonId, employeeId: session.employeeId } : null;
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
 * May this scope create or move work for `employeeId`? A salon-wide scope books
 * for anyone; a master books only for themselves. Call it before trusting an
 * employeeId that arrived in a request body.
 */
export function canActForEmployee(scope: SalonScope, employeeId: string): boolean {
  return scope.employeeId === null || scope.employeeId === employeeId;
}

/**
 * Why an employee's own login (a master's) stops working. Re-derived on EVERY
 * request, so revoking access is immediate: no claim cached in the session
 * cookie can outlive it.
 *   plan     — the account fell to a tier without staffRoles (lapsed trial,
 *              missed payment). Staff logins are a paid feature.
 *   inactive — the owner deactivated the master, or their employee record is
 *              gone. Deactivating someone is how a salon says "not any more",
 *              and it has to close the login too, not just the calendar column.
 */
export type StaffBlockedReason = "plan" | "inactive";

export function staffBlockedReason(opts: {
  /** The login belongs to an employee (see isEmployeeLogin). */
  employeeLogin: boolean;
  staffRolesEnabled: boolean;
  /** Employee.isActive; null/undefined when the record no longer resolves. */
  employeeIsActive: boolean | null | undefined;
}): StaffBlockedReason | null {
  if (!opts.employeeLogin) return null;
  if (!opts.staffRolesEnabled) return "plan";
  // Anything other than an explicit `true` — false, null, a membership whose
  // employee was deleted — closes the login. Fail closed, not open.
  return opts.employeeIsActive === true ? null : "inactive";
}

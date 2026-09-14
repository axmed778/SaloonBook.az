// Session-reading wrappers around the pure rules in ./permissions and ./access.
//
// Server actions are NOT protected by the dashboard layout: they are POSTs to a
// route of their own, so "the button isn't on the screen" is not a control.
// Every action therefore opens with requirePermission() or requireScope(), and
// every dashboard page with requirePagePermission(). guard-coverage.test.ts fails
// when one does not.

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession, type Session } from "./session";
import { salonScopeFor, type SalonScope } from "./access";
import { hasPermission, type Permission } from "./permissions";

/**
 * These refusals are "should never happen" guards — the UI does not offer a role
 * the buttons it may not press. But a stale tab is enough to reach one: sign in
 * as somebody else in the same browser and the page already on screen still
 * shows the previous account's controls, whose next click arrives with the new
 * session. That lands the message in front of a real person, so it is written
 * for one, in their language, and says what to do about it.
 */
async function refusal(key: "noSalon" | "forbidden" | "sessionInvalid"): Promise<Error> {
  const t = await getTranslations("Auth.guard");
  return new Error(t(key));
}

/** A session scoped to a salon. */
export type SalonSession = Session & { salonId: string };

/**
 * The caller's session, provided their role holds `permission` in the salon
 * they are working in. Throws otherwise — including for a master whose access
 * was revoked, whose salonId getSession() deliberately nulls out.
 *
 * This checks the ROLE. A plan gate stays with its feature: payroll, the data
 * exports and staff logins keep their own checks and their own upgrade
 * messages, and finance actions ask planIncludes() for theirs.
 */
export async function requirePermission(permission: Permission): Promise<SalonSession> {
  const session = await getSession();
  if (!session?.salonId) throw await refusal("noSalon");
  if (!hasPermission(session, permission)) throw await refusal("forbidden");
  return { ...session, salonId: session.salonId };
}

/**
 * Salon + row scope for the bookings every role shares: the whole salon, or a
 * master's own column. Pass the result to appointmentScope()/canActForEmployee()
 * rather than reading `employeeId` ad hoc.
 */
export async function requireScope(
  permission: "bookings.read" | "bookings.write",
): Promise<SalonScope> {
  const session = await requirePermission(permission);
  // A master's membership always has an employeeId (grantStaffAccess writes them
  // together). Treating a missing one as "the whole salon" would silently widen
  // a master to owner reach, so refuse instead.
  const scope = salonScopeFor(session);
  if (!scope) throw await refusal("sessionInvalid");
  return scope;
}

/**
 * Page-level gate. A role without the permission is sent back to its own day
 * rather than shown a permission error — they did nothing wrong, that screen is
 * simply not theirs. Platform admins pass: they have no salon, and each page
 * shows them its own notice.
 */
export async function requirePagePermission(permission: Permission): Promise<Session> {
  // The dashboard layout already bounced anyone without a session.
  const session = (await getSession())!;
  if (!session.isAdmin && !hasPermission(session, permission)) {
    redirect({ href: "/dashboard", locale: await getLocale() });
  }
  return session;
}

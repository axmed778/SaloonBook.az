// Session-reading wrappers around the pure rules in ./permissions and ./access.
//
// Server actions are NOT protected by the dashboard layout: they are POSTs to a
// route of their own, so "the button isn't on the screen" is not a control.
// Every action therefore opens with requirePermission() or requireScope(), and
// every dashboard page with requirePagePermission() or requirePageAccess().
// guard-coverage.test.ts fails when one does not.
//
// Each of them asks the role AND the plan (accessRefusal), so a plan-gated
// permission is refused here and never needs a check of its own.

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession, type Session } from "./session";
import { salonScopeFor, type SalonScope } from "./access";
import { accessRefusal, canUpgradePlan, type Permission } from "./permissions";

/**
 * These refusals are "should never happen" guards — the UI does not offer a role
 * the buttons it may not press. But a stale tab is enough to reach one: sign in
 * as somebody else in the same browser, or let the plan lapse, and the page
 * already on screen still shows controls whose next click arrives with the new
 * session. That lands the message in front of a real person, so it is written
 * for one, in their language, and says what to do about it.
 */
async function refusal(
  key: "noSalon" | "forbidden" | "planRequired" | "sessionInvalid",
): Promise<Error> {
  const t = await getTranslations("Auth.guard");
  return new Error(t(key));
}

/** A session scoped to a salon. */
export type SalonSession = Session & { salonId: string };

/**
 * redirect() throws, but the locale-aware wrapper is not typed as never, so the
 * pages below would not narrow after it. This is, and the throw after it only
 * makes that true should redirect() ever return.
 */
function sendTo(href: string, locale: string): never {
  redirect({ href, locale });
  throw new Error(`redirect to ${href} did not throw`);
}

/**
 * The caller's session, provided their role holds `permission` in the salon they
 * are working in and their plan includes it. Throws otherwise — including for a
 * login that was closed, whose salonId getSession() deliberately nulls out.
 */
export async function requirePermission(permission: Permission): Promise<SalonSession> {
  const session = await getSession();
  if (!session?.salonId) throw await refusal("noSalon");
  const refused = accessRefusal(session, [permission]);
  if (refused === "role") throw await refusal("forbidden");
  if (refused === "plan") throw await refusal("planRequired");
  return { ...session, salonId: session.salonId };
}

/**
 * requirePermission() for the few actions whose refusal is a silent no-op rather
 * than an error: null instead of a throw, on exactly the same rules.
 */
export async function requirePermissionOrNull(
  permission: Permission,
): Promise<SalonSession | null> {
  const session = await getSession();
  if (!session?.salonId || accessRefusal(session, [permission]) !== null) return null;
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
 * What a page may render: its content, or — when the plan lacks the feature — an
 * upgrade card for whoever can change the plan (`canUpgrade`, the owner) and the
 * plan-required screen for everyone else.
 */
export type PageAccess =
  | { granted: true; session: Session }
  | { granted: false; reason: "plan"; canUpgrade: boolean };

/**
 * Page-level gate for a page with an upgrade card of its own. A role without the
 * permission is sent back to its own day rather than shown a permission error —
 * they did nothing wrong, that screen is simply not theirs. A role that holds it
 * on a plan that doesn't include it gets `granted: false`, and no session: the
 * page cannot render its content without first handling that.
 */
export async function requirePageAccess(permission: Permission): Promise<PageAccess> {
  const locale = await getLocale();
  const session = await getSession();
  // The dashboard layout bounces a missing session first; this is the same rule
  // for a page rendered without it, instead of trusting that it ran.
  if (!session) sendTo("/login", locale);

  // Platform admins pass: they have no salon, and each page shows them its own
  // notice.
  if (session.isAdmin) return { granted: true, session };
  // A closed login keeps its session so the layout can explain why, and the
  // layout shows that explanation instead of any page. It has no salon and no
  // permissions, so the page underneath renders only its empty state. Sending it
  // to Today instead would loop: Today asks too.
  if (session.staffBlocked) return { granted: true, session };

  const refused = accessRefusal(session, [permission]);
  // Today needs bookings.read, which every role holds, so this cannot loop.
  if (refused === "role") sendTo("/dashboard", locale);
  if (refused === "plan") {
    return { granted: false, reason: "plan", canUpgrade: canUpgradePlan(session) };
  }
  return { granted: true, session };
}

/**
 * Page-level gate for a page without an upgrade card of its own. When the plan
 * lacks the permission, the owner is sent to Billing, where they can change it;
 * anyone else — who could not open Billing — to the plan-required screen, which
 * tells them to ask the owner.
 */
export async function requirePagePermission(permission: Permission): Promise<Session> {
  const access = await requirePageAccess(permission);
  if (!access.granted) {
    sendTo(access.canUpgrade ? "/dashboard/billing" : "/dashboard/plan-required", await getLocale());
  }
  return access.session;
}

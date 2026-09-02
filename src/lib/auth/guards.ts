// Session-reading wrappers around the pure rules in ./access.
//
// Server actions are NOT protected by the dashboard layout: they are POSTs to a
// route of their own, so "the master never sees the button" is not a control.
// Every action therefore opens with one of these, exactly as every action
// already opened with a salon check.

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession, type Session } from "./session";
import type { SalonScope } from "./access";

/**
 * These refusals are "should never happen" guards — the UI does not offer a
 * master the buttons they protect. But a stale tab is enough to reach one: sign
 * in as somebody else in the same browser and the page already on screen still
 * shows the previous account's controls, whose next click arrives with the new
 * session. That lands the message in front of a real person, so it is written
 * for one, in their language, and says what to do about it.
 */
async function refusal(key: "noSalon" | "ownerOnly" | "sessionInvalid"): Promise<Error> {
  const t = await getTranslations("Auth.guard");
  return new Error(t(key));
}

/**
 * The caller's salon, whoever they are (owner or master). Throws when the
 * session carries none — including a master whose access was revoked, whose
 * salonId getSession() deliberately nulls out.
 */
export async function requireSalonId(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw await refusal("noSalon");
  return session.salonId;
}

/**
 * Salon + row scope for a surface both roles share (the calendar and the
 * bookings on it). Pass the result to appointmentScope()/canActForEmployee()
 * rather than reading `employeeId` ad hoc.
 */
export async function requireScope(): Promise<SalonScope> {
  const session = await getSession();
  if (!session?.salonId) throw await refusal("noSalon");
  // A STAFF membership always has an employeeId (grantStaffAccess writes them
  // together). Treating a missing one as "the whole salon" would silently widen
  // a master to owner reach, so refuse instead.
  if (session.isStaff && !session.employeeId) {
    throw await refusal("sessionInvalid");
  }
  return {
    salonId: session.salonId,
    employeeId: session.isStaff ? session.employeeId : null,
  };
}

/** Full session of an OWNER caller. Throws for a master's login. */
export async function requireOwnerSession(): Promise<Session> {
  const session = await getSession();
  if (!session?.salonId) throw await refusal("noSalon");
  if (session.role !== "OWNER") throw await refusal("ownerOnly");
  return session;
}

/** Salon of an OWNER caller — the drop-in replacement for the old helper in
 *  every action that manages the salon rather than the day's work. */
export async function requireOwnerSalonId(): Promise<string> {
  return (await requireOwnerSession()).salonId!;
}

/**
 * Page-level owner gate. A master who types an owner-only URL is sent back to
 * their own day rather than shown a permission error — they did not do anything
 * wrong, that screen is simply not theirs.
 */
export async function requireOwnerPage(): Promise<Session> {
  const session = await getSession();
  // The dashboard layout already bounced anyone without a session.
  if (session?.isStaff) {
    redirect({ href: "/dashboard", locale: await getLocale() });
  }
  return session!;
}

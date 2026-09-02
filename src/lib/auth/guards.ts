// Session-reading wrappers around the pure rules in ./access.
//
// Server actions are NOT protected by the dashboard layout: they are POSTs to a
// route of their own, so "the master never sees the button" is not a control.
// Every action therefore opens with one of these, exactly as every action
// already opened with a salon check.

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession, type Session } from "./session";
import type { SalonScope } from "./access";

/**
 * The caller's salon, whoever they are (owner or master). Throws when the
 * session carries none — including a master whose access was revoked, whose
 * salonId getSession() deliberately nulls out.
 */
export async function requireSalonId(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  return session.salonId;
}

/**
 * Salon + row scope for a surface both roles share (the calendar and the
 * bookings on it). Pass the result to appointmentScope()/canActForEmployee()
 * rather than reading `employeeId` ad hoc.
 */
export async function requireScope(): Promise<SalonScope> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  // A STAFF membership always has an employeeId (grantStaffAccess writes them
  // together). Treating a missing one as "the whole salon" would silently widen
  // a master to owner reach, so refuse instead.
  if (session.isStaff && !session.employeeId) {
    throw new Error("Forbidden: staff membership without an employee");
  }
  return {
    salonId: session.salonId,
    employeeId: session.isStaff ? session.employeeId : null,
  };
}

/** Full session of an OWNER caller. Throws for a master's login. */
export async function requireOwnerSession(): Promise<Session> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  if (session.role !== "OWNER") throw new Error("Forbidden: owner only");
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

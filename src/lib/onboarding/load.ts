// What the mandatory setup gate needs about the salon and the person, loaded
// once in the dashboard layout and handed down finished (the rules are in
// ./gate.ts). Server-only: Prisma.

import { prisma } from "../prisma";
import { accessRefusal, type Permission } from "../auth/permissions";
import type { Session } from "../auth/session";
import { isProfileComplete } from "../guides/checklist";
import { marketingKeyForPlan, type MarketingPlanKey } from "../plans";
import { buildGate, type GateState } from "./gate";

/**
 * Doing the five steps needs all three: the salon's details, its catalogue and
 * its team. Whoever cannot do one of them cannot be the person the gate asks —
 * a master or reception would be held at a wall they are not allowed through.
 * Asked as permissions, never by role name, and the plan question comes with
 * them: an account whose trial lapsed is refused `staff.manage`, and must reach
 * the billing page rather than a setup step it cannot save.
 */
const GATE_PERMISSIONS: readonly Permission[] = ["settings.write", "services.write", "staff.manage"];

export interface SetupGateData extends GateState {
  /** Prefill for the profile step. */
  salonName: string;
  phone: string | null;
  address: string | null;
  /** The salon's public booking link, for the last step. */
  bookingUrl: string;
  /** The master the hours step sets the week for (the one without hours). */
  employee: { id: string; name: string } | null;
  /**
   * An active master already on the team who does none of the salon's active
   * services — offered as the master step's answer, so confirming links the
   * services to them instead of adding a second person by the same name.
   */
  masterSuggestion: string | null;
  /** How many masters the owner said they had at registration; null if unknown. */
  signupStaffCount: number | null;
  /** The tier the trial is running on, so the gate can name it. */
  planKey: MarketingPlanKey | null;
}

/**
 * The gate for this session, or null when there is none to show: not this
 * person's to do, or every required step already satisfied by the salon's own
 * rows — which is how every salon set up before the gate existed never sees it.
 */
export async function loadSetupGate(session: Session): Promise<SetupGateData | null> {
  const salonId = session.salonId;
  if (!salonId || session.isAdmin) return null;
  if (accessRefusal(session, GATE_PERMISSIONS) !== null) return null;

  // A master counts only if they do at least one active service: the public
  // page offers a master per service, and the availability route refuses a
  // master/service pair with no link. Hours count only on such a master, so
  // "a week exists" and "a service exists" can never be satisfied by two
  // different people and leave a salon that still offers no slot.
  const servesActive = { services: { some: { service: { isActive: true } } } };
  const [salon, activeService, employee, bookable, unlinked, guideState, onlineBooking] =
    await Promise.all([
      prisma.salon.findUnique({
        where: { id: salonId },
        select: {
          name: true,
          slug: true,
          phone: true,
          address: true,
          account: { select: { signupStaffCount: true } },
        },
      }),
      prisma.service.findFirst({ where: { salonId, isActive: true }, select: { id: true } }),
      // The master the hours step will fill in: the longest-serving one still
      // without a week, else just the first.
      prisma.employee.findFirst({
        where: { salonId, isActive: true, ...servesActive },
        orderBy: [{ workingHours: { _count: "asc" } }, { createdAt: "asc" }],
        select: { id: true, name: true },
      }),
      prisma.employee.findFirst({
        where: { salonId, isActive: true, workingHours: { some: {} }, ...servesActive },
        select: { id: true },
      }),
      prisma.employee.findFirst({
        where: { salonId, isActive: true, services: { none: { service: { isActive: true } } } },
        orderBy: { createdAt: "asc" },
        select: { name: true },
      }),
      prisma.userGuideState.findUnique({
        where: { userId: session.user.id },
        select: { linkCopiedAt: true, onboardingStartedAt: true },
      }),
      prisma.appointment.findFirst({
        where: { salonId, source: "PUBLIC" },
        select: { id: true },
      }),
    ]);
  if (!salon) return null;

  const gate = buildGate({
    profileComplete: isProfileComplete(salon),
    hasActiveServices: activeService !== null,
    hasBookableMaster: employee !== null,
    hasStaffHours: bookable !== null,
    // A client who has already booked online is proof the link is out there,
    // same as the checklist reads it — a salon with real bookings is never
    // held at a step that asks it to share the link. And an owner from before
    // the first-run flow (no onboardingStartedAt) is not asked at all: their
    // salon has been running, the link has very likely been handed out by
    // hand, and nothing in the database could say so either way. Holding an
    // established salon at a wall over that guess is the wrong side to err on.
    linkShared:
      !!guideState?.linkCopiedAt || onlineBooking !== null || !guideState?.onboardingStartedAt,
  });
  if (!gate) return null;

  // Same origin the Settings page and the help panel show the link with.
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return {
    ...gate,
    salonName: salon.name,
    phone: salon.phone,
    address: salon.address,
    bookingUrl: `${appUrl}/${salon.slug}`,
    employee,
    masterSuggestion: unlinked?.name ?? null,
    signupStaffCount: salon.account.signupStaffCount,
    planKey: marketingKeyForPlan(session.plan),
  };
}

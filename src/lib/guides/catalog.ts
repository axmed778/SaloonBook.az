// Loads what the guides and the first-run checklist need to know about the
// salon and the person, and turns it into the finished data the dashboard hands
// to the client (the rules are in availability.ts and checklist.ts).
// Server-only: Prisma.

import { prisma } from "../prisma";
import { limitsFor } from "../plans";
import type { Session } from "../auth/session";
import { factsNeeded, guideCatalog, guidesForRole, type GuideEntry } from "./availability";
import { buildSetup, isProfileComplete, setupEligible, type SetupState } from "./checklist";
import type { GuideFact } from "./registry";

export interface HelpData {
  catalog: GuideEntry[];
  /** The first-run checklist, or null when it is not this person's or all done. */
  setup: SetupState | null;
  /** The salon's public booking link, for the checklist's own "Copy" button. */
  bookingUrl: string | null;
}

const NONE: HelpData = { catalog: [], setup: null, bookingUrl: null };

/** A findFirst for "is there one", as a boolean. */
const exists = (row: Promise<{ id: string } | null>) => row.then((r) => r !== null);
const no = Promise.resolve(false);

/**
 * The guides and the checklist for this session. Nothing for a session with no
 * salon (a platform admin, a closed login): there is no salon screen to guide.
 *
 * The seat count is the same one assertEmployeeSeatAvailable() makes when the
 * employee is saved — active employees against the effective plan's limit — so
 * the panel and the save agree on whether a seat is free. The save stays the
 * authority (it locks and re-counts); this only spares the person a dead end.
 *
 * Only what the offered guides and the checklist need is queried: a role with
 * no guides costs nothing, and every query is a count or an existence check on
 * an indexed salonId.
 */
export async function loadHelpData(session: Session): Promise<HelpData> {
  const salonId = session.salonId;
  if (!salonId || session.isAdmin) return NONE;

  const guides = guidesForRole(session);
  const eligible = setupEligible(session);
  if (guides.length === 0 && !eligible) return NONE;

  const need = factsNeeded(guides);
  const wants = (fact: GuideFact) => need.facts.has(fact);
  const max = limitsFor(session.plan).maxEmployees;
  const countEmployees = need.seats || eligible || wants("hasActiveEmployees");

  const [
    state,
    anyService,
    activeService,
    activeEmployees,
    bookableStaff,
    staffHours,
    salon,
    anyBooking,
    onlineBooking,
  ] = await Promise.all([
    prisma.userGuideState.findUnique({
      where: { userId: session.user.id },
      select: {
        completedGuides: true,
        onboardingStartedAt: true,
        welcomeShownAt: true,
        checklistHidden: true,
        linkCopiedAt: true,
      },
    }),
    wants("hasServices") ? exists(prisma.service.findFirst({ where: { salonId }, select: { id: true } })) : no,
    wants("hasActiveServices") || eligible
      ? exists(prisma.service.findFirst({ where: { salonId, isActive: true }, select: { id: true } }))
      : no,
    countEmployees ? prisma.employee.count({ where: { salonId, isActive: true } }) : Promise.resolve(0),
    wants("hasBookableStaff")
      ? exists(
          prisma.employee.findFirst({
            where: {
              salonId,
              isActive: true,
              workingHours: { some: {} },
              services: { some: { service: { isActive: true } } },
            },
            select: { id: true },
          }),
        )
      : no,
    eligible
      ? exists(
          prisma.employee.findFirst({
            where: { salonId, isActive: true, workingHours: { some: {} } },
            select: { id: true },
          }),
        )
      : no,
    eligible
      ? prisma.salon.findUnique({ where: { id: salonId }, select: { phone: true, address: true, slug: true } })
      : Promise.resolve(null),
    eligible ? exists(prisma.appointment.findFirst({ where: { salonId }, select: { id: true } })) : no,
    eligible
      ? exists(prisma.appointment.findFirst({ where: { salonId, source: "PUBLIC" }, select: { id: true } }))
      : no,
  ]);

  const catalog = guideCatalog(
    session,
    {
      hasServices: anyService,
      hasActiveServices: activeService,
      hasActiveEmployees: activeEmployees > 0,
      hasBookableStaff: bookableStaff,
      employeeSeats: { active: activeEmployees, max },
    },
    state?.completedGuides ?? [],
  );

  const setup = eligible
    ? buildSetup(
        session,
        {
          profileComplete: salon ? isProfileComplete(salon) : false,
          hasActiveServices: activeService,
          hasActiveEmployees: activeEmployees > 0,
          hasStaffHours: staffHours,
          linkCopied: !!state?.linkCopiedAt,
          hasOnlineBooking: onlineBooking,
          hasAppointments: anyBooking,
        },
        {
          onboardingStartedAt: state?.onboardingStartedAt ?? null,
          welcomeShownAt: state?.welcomeShownAt ?? null,
          checklistHidden: state?.checklistHidden ?? false,
        },
      )
    : null;

  // Same origin the Settings page shows the link with.
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return { catalog, setup, bookingUrl: salon ? `${appUrl}/${salon.slug}` : null };
}

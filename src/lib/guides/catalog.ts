// Loads what the guides need to know about the salon and the person, and turns
// it into the finished list the dashboard hands to the client (see
// availability.ts for the rules). Server-only: Prisma.

import { prisma } from "../prisma";
import { limitsFor } from "../plans";
import type { Session } from "../auth/session";
import { factsNeeded, guideCatalog, guidesForRole, type GuideEntry } from "./availability";

/**
 * The guides this session is offered. Empty for a session with no salon (a
 * platform admin, a closed login): there is no salon screen to guide them on.
 *
 * The seat count is the same one assertEmployeeSeatAvailable() makes when the
 * employee is saved — active employees against the effective plan's limit — so
 * the panel and the save agree on whether a seat is free. The save stays the
 * authority (it locks and re-counts); this only spares the person a dead end.
 */
export async function loadGuideCatalog(session: Session): Promise<GuideEntry[]> {
  const salonId = session.salonId;
  if (!salonId || session.isAdmin) return [];

  const guides = guidesForRole(session);
  if (guides.length === 0) return [];
  const need = factsNeeded(guides);
  const max = limitsFor(session.plan).maxEmployees;

  const [serviceCount, activeEmployees, state] = await Promise.all([
    need.services ? prisma.service.count({ where: { salonId } }) : Promise.resolve(0),
    need.seats && Number.isFinite(max)
      ? prisma.employee.count({ where: { salonId, isActive: true } })
      : Promise.resolve(0),
    prisma.userGuideState.findUnique({
      where: { userId: session.user.id },
      select: { completedGuides: true },
    }),
  ]);

  return guideCatalog(
    session,
    { hasServices: serviceCount > 0, employeeSeats: { active: activeEmployees, max } },
    state?.completedGuides ?? [],
  );
}

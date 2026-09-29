// The first-run checklist on the Today page: six things a new salon needs
// before clients can book it online, each done or not by what the DATABASE
// holds — never by a tick the person sets. And the welcome dialog that leads
// into it.
//
// Who sees it: whoever may do all six — asked through accessRefusal(), never by
// role name. Today that is the owner; everyone else sees only the guides their
// role may run, in the help panel.
//
// PURE, like ./availability: the loader (catalog.ts) reads the rows, this
// decides.

import { accessRefusal } from "../auth/permissions";
import type { Subject } from "./availability";
import { guideById, type GuideId } from "./registry";

export const SETUP_ITEMS = [
  { id: "profile", guide: "salonProfile" },
  { id: "services", guide: "addService" },
  { id: "worker", guide: "addWorker" },
  { id: "hours", guide: "workingHours" },
  { id: "link", guide: "bookingLink" },
  { id: "booking", guide: "manualBooking" },
] as const satisfies readonly { id: string; guide: GuideId }[];

export type SetupItemId = (typeof SETUP_ITEMS)[number]["id"];

/** The salon's data, as the checklist reads it. */
export interface SetupFacts {
  /** Phone and address both filled in (what a client needs to find and call). */
  profileComplete: boolean;
  hasActiveServices: boolean;
  hasActiveEmployees: boolean;
  /** At least one active employee has working hours — what online booking offers slots from. */
  hasStaffHours: boolean;
  /** This person pressed "Copy" next to the booking link somewhere. */
  linkCopied: boolean;
  /** A client has booked through the public link: it is evidently out there. */
  hasOnlineBooking: boolean;
  /** Any booking at all in the salon — the test booking, or a real one. */
  hasAppointments: boolean;
}

/** The person's own first-run state (UserGuideState). */
export interface SetupUserState {
  onboardingStartedAt: Date | null;
  welcomeShownAt: Date | null;
  checklistHidden: boolean;
}

export interface SetupItem {
  id: SetupItemId;
  guide: GuideId;
  done: boolean;
}

export interface SetupState {
  items: SetupItem[];
  done: number;
  total: number;
  /** Skipped by the person; the help panel offers it back. */
  hidden: boolean;
  /** Show the welcome dialog: signed up through the first-run flow and not seen it yet. */
  welcome: boolean;
}

export function isProfileComplete(salon: { phone: string | null; address: string | null }): boolean {
  return !!salon.phone?.trim() && !!salon.address?.trim();
}

function itemDone(id: SetupItemId, f: SetupFacts): boolean {
  switch (id) {
    case "profile":
      return f.profileComplete;
    case "services":
      return f.hasActiveServices;
    case "worker":
      return f.hasActiveEmployees;
    case "hours":
      return f.hasStaffHours;
    case "link":
      return f.linkCopied || f.hasOnlineBooking;
    case "booking":
      return f.hasAppointments;
  }
}

/** May this person do every item? Then the checklist is theirs. */
export function setupEligible(subject: Subject): boolean {
  return SETUP_ITEMS.every((item) => {
    const guide = guideById(item.guide);
    return !!guide && accessRefusal(subject, guide.permissions) === null;
  });
}

/**
 * The checklist for this person, or null when there is none to show: not theirs
 * to do, or every item already done. The last is what keeps it away from
 * salons that were set up long before it existed — their data already answers
 * it — while a salon still missing a step sees exactly that step.
 */
export function buildSetup(subject: Subject, facts: SetupFacts, state: SetupUserState): SetupState | null {
  if (!setupEligible(subject)) return null;
  const items = SETUP_ITEMS.map((i) => ({ id: i.id, guide: i.guide as GuideId, done: itemDone(i.id, facts) }));
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return {
    items,
    done,
    total: items.length,
    hidden: state.checklistHidden,
    welcome: state.onboardingStartedAt !== null && state.welcomeShownAt === null,
  };
}

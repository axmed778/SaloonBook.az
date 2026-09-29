// The interactive guides, as data.
//
// A guide is a list of steps, each pointing at a real element on a dashboard
// screen by its `data-tour` attribute (never by CSS class, which changes with
// every restyle). The engine (src/components/guides/) highlights that element,
// shows the step's two sentences next to it, and moves on when the person has
// actually done the thing: clicked it, filled it in, reached the page.
//
// Texts are NOT here. Each step's words live in messages/*.json under
//   Guides.guides.<guideId>.title
//   Guides.guides.<guideId>.steps.<stepId>.do    — what to press, and where
//   Guides.guides.<guideId>.steps.<stepId>.why   — why it matters
// registry.test.ts fails when a key is missing in any locale, or when a target
// has no matching data-tour="…" anywhere in src/.
//
// Who may run a guide is decided on the server (availability.ts), from the
// `permissions` below and the plan, and handed to the client ready-made. The
// client never filters this list itself.
//
// PURE: no React, no Prisma. The server imports it to decide availability, the
// client to run the steps.

import type { LoginKind, Permission } from "../auth/permissions";

/**
 * How a step is finished:
 *   click     the person presses the highlighted element.
 *   input     the person fills in the highlighted field (or, for a group of
 *             choices, picks at least one) — see GuideStep.target.
 *   navigate  the person reaches `route`; the target is the menu entry to it.
 *   info      nothing to do on screen; "Next" moves on.
 */
export type GuideStepType = "click" | "input" | "navigate" | "info";

export interface GuideStep {
  /** Stable id, used in the message keys. */
  id: string;
  type: GuideStepType;
  /** The data-tour value of the element to highlight. Optional only for info. */
  target?: string;
  /**
   * The page the target lives on (locale prefix stripped). A navigate step must
   * name the page it leads to; other steps name theirs so a resumed guide on the
   * wrong page can offer to go there instead of waiting for nothing.
   */
  route?: string;
  /**
   * A click that submits a form: the step is done when the target disappears
   * after the press (the form closed because the save worked), not on the press
   * itself — a press that fails validation keeps the person on this step.
   */
  awaitRemoval?: boolean;
  /**
   * A click that submits a form which stays open (Settings): the step is done
   * when this element — the form's "Saved" line — appears after the press.
   */
  successTarget?: string;
  /**
   * data-tour of the form's error line. When it shows up after the press, the
   * spotlight widens to it and the step says the save did not go through.
   */
  errorTarget?: string;
}

/** The help panel's groups, in display order. */
export const GUIDE_SECTIONS = ["salon", "services", "team", "schedule", "bookings", "billing"] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number];

/**
 * A plan limit a guide can run into. The server counts it before the guide
 * starts, so a person is told up front instead of being walked into a refusal.
 */
export type GuideLimit = "employeeSeats";

/**
 * What the salon's data must already hold for a guide not to dead-end. Loaded
 * on the server (catalog.ts); each is a plain yes/no about the salon.
 */
export const GUIDE_FACTS = [
  "hasServices", // any service, active or not (the add-on form lists them all)
  "hasActiveServices",
  "hasActiveEmployees",
  "hasBookableStaff", // an active employee with an active service and working hours
] as const;
export type GuideFact = (typeof GUIDE_FACTS)[number];

export interface GuideDef {
  id: string;
  section: GuideSection;
  /**
   * What the person must be allowed to do — every one of them, asked together
   * with accessRefusal(). More than one when the guide crosses screens.
   */
  permissions: readonly Permission[];
  /** The page the guide works on. */
  route: string;
  /** A plan limit the guide's action consumes, checked before it starts. */
  limit?: GuideLimit;
  /**
   * The guide hands out a login of this kind. The permission alone does not
   * say whether the PLAN includes such logins; permissions.ts answers that
   * (loginKindOnPlan), and the guide explains the plan instead of dead-ending.
   */
  handsOutLogin?: LoginKind;
  /**
   * Not offered to a role holding this permission: it reaches the same thing
   * another way, with its own guide (the owner plans time off on the Staff
   * screen; reception on the Time off page). Same rule as the sidebar's.
   */
  hideWith?: Permission;
  /**
   * What must exist first, and the guide that makes it. The add-on form cannot
   * be saved without a service; a booking needs a master who can take it. The
   * first unmet one is offered instead. registry.test.ts checks the ids exist.
   * (`guide` is a string here: GuideId derives from this very list.)
   */
  needs?: readonly { fact: GuideFact; guide: string }[];
  steps: readonly GuideStep[];
}

const SERVICES = "/dashboard/services";
const WORKERS = "/dashboard/workers";
const SETTINGS = "/dashboard/settings";
const CALENDAR = "/dashboard/calendar";
const TIME_OFF = "/dashboard/time-off";
const BILLING = "/dashboard/billing";

export const GUIDES = [
  {
    id: "salonProfile",
    section: "salon",
    permissions: ["settings.write"],
    route: SETTINGS,
    steps: [
      { id: "openPage", type: "navigate", target: "nav.settings", route: SETTINGS },
      { id: "phone", type: "input", target: "settings.phone", route: SETTINGS },
      { id: "address", type: "input", target: "settings.address", route: SETTINGS },
      {
        id: "save",
        type: "click",
        target: "settings.profile-save",
        route: SETTINGS,
        successTarget: "settings.profile-saved",
        errorTarget: "settings.profile-error",
      },
      { id: "done", type: "info", route: SETTINGS },
    ],
  },
  {
    id: "addService",
    section: "services",
    permissions: ["services.write"],
    route: SERVICES,
    steps: [
      { id: "openPage", type: "navigate", target: "nav.services", route: SERVICES },
      { id: "openForm", type: "click", target: "service.add", route: SERVICES },
      { id: "name", type: "input", target: "service.name", route: SERVICES },
      { id: "price", type: "input", target: "service.price", route: SERVICES },
      { id: "duration", type: "input", target: "service.duration", route: SERVICES },
      {
        id: "save",
        type: "click",
        target: "service.save",
        route: SERVICES,
        awaitRemoval: true,
        errorTarget: "service.error",
      },
      { id: "done", type: "info", route: SERVICES },
    ],
  },
  {
    id: "addAddon",
    section: "services",
    permissions: ["services.write"],
    route: SERVICES,
    needs: [{ fact: "hasServices", guide: "addService" }],
    steps: [
      { id: "openPage", type: "navigate", target: "nav.services", route: SERVICES },
      { id: "openForm", type: "click", target: "addon.add", route: SERVICES },
      { id: "name", type: "input", target: "addon.name", route: SERVICES },
      { id: "price", type: "input", target: "addon.price", route: SERVICES },
      { id: "services", type: "input", target: "addon.services", route: SERVICES },
      {
        id: "save",
        type: "click",
        target: "addon.save",
        route: SERVICES,
        awaitRemoval: true,
        errorTarget: "addon.error",
      },
      { id: "done", type: "info", route: SERVICES },
    ],
  },
  {
    id: "addWorker",
    section: "team",
    permissions: ["staff.manage"],
    route: WORKERS,
    limit: "employeeSeats",
    steps: [
      { id: "openPage", type: "navigate", target: "nav.workers", route: WORKERS },
      { id: "openForm", type: "click", target: "worker.add", route: WORKERS },
      { id: "name", type: "input", target: "worker.name", route: WORKERS },
      { id: "services", type: "input", target: "worker.services", route: WORKERS },
      { id: "hours", type: "info", target: "worker.hours", route: WORKERS },
      {
        id: "save",
        type: "click",
        target: "worker.save",
        route: WORKERS,
        awaitRemoval: true,
        errorTarget: "worker.error",
      },
      { id: "done", type: "info", route: WORKERS },
    ],
  },
  {
    // Both places hours live: each master's own (what online booking offers)
    // first, then the salon's opening hours (what the salon page shows).
    id: "workingHours",
    section: "schedule",
    permissions: ["staff.manage", "settings.write"],
    route: WORKERS,
    needs: [{ fact: "hasActiveEmployees", guide: "addWorker" }],
    steps: [
      { id: "openWorkers", type: "navigate", target: "nav.workers", route: WORKERS },
      { id: "edit", type: "click", target: "worker.edit", route: WORKERS },
      { id: "hours", type: "info", target: "worker.hours", route: WORKERS },
      {
        id: "save",
        type: "click",
        target: "worker.save",
        route: WORKERS,
        awaitRemoval: true,
        errorTarget: "worker.error",
      },
      { id: "openSettings", type: "navigate", target: "nav.settings", route: SETTINGS },
      { id: "salonHours", type: "info", target: "settings.hours", route: SETTINGS },
      {
        id: "salonHoursSave",
        type: "click",
        target: "settings.hours-save",
        route: SETTINGS,
        successTarget: "settings.hours-saved",
        errorTarget: "settings.hours-error",
      },
      { id: "done", type: "info", route: SETTINGS },
    ],
  },
  {
    id: "bookingLink",
    section: "bookings",
    permissions: ["settings.write"],
    route: SETTINGS,
    steps: [
      { id: "openPage", type: "navigate", target: "nav.settings", route: SETTINGS },
      { id: "copy", type: "click", target: "settings.link-copy", route: SETTINGS },
      { id: "instagram", type: "info", route: SETTINGS },
      { id: "done", type: "info", route: SETTINGS },
    ],
  },
  {
    id: "manualBooking",
    section: "bookings",
    permissions: ["bookings.write"],
    route: CALENDAR,
    needs: [
      { fact: "hasActiveServices", guide: "addService" },
      { fact: "hasBookableStaff", guide: "addWorker" },
    ],
    steps: [
      { id: "openPage", type: "navigate", target: "nav.calendar", route: CALENDAR },
      { id: "openForm", type: "click", target: "calendar.new-booking", route: CALENDAR },
      { id: "employee", type: "input", target: "booking.employee", route: CALENDAR },
      { id: "service", type: "input", target: "booking.service", route: CALENDAR },
      { id: "slot", type: "input", target: "booking.slots", route: CALENDAR },
      { id: "name", type: "input", target: "booking.name", route: CALENDAR },
      { id: "phone", type: "input", target: "booking.phone", route: CALENDAR },
      {
        id: "save",
        type: "click",
        target: "booking.save",
        route: CALENDAR,
        awaitRemoval: true,
        errorTarget: "booking.error",
      },
      { id: "done", type: "info", route: CALENDAR },
    ],
  },
  {
    id: "masterLogin",
    section: "team",
    permissions: ["staff.manage"],
    route: WORKERS,
    handsOutLogin: "masterLogin",
    needs: [{ fact: "hasActiveEmployees", guide: "addWorker" }],
    steps: [
      { id: "openPage", type: "navigate", target: "nav.workers", route: WORKERS },
      { id: "openAccess", type: "click", target: "worker.access", route: WORKERS },
      { id: "email", type: "input", target: "access.email", route: WORKERS },
      { id: "password", type: "input", target: "access.password", route: WORKERS },
      {
        id: "save",
        type: "click",
        target: "access.save",
        route: WORKERS,
        successTarget: "access.issued",
        errorTarget: "access.error",
      },
      { id: "handOver", type: "info", target: "access.issued", route: WORKERS },
      { id: "done", type: "info", route: WORKERS },
    ],
  },
  {
    // The owner's way in: each person's time off sits on the Staff screen.
    id: "timeOff",
    section: "schedule",
    permissions: ["staff.manage"],
    route: WORKERS,
    needs: [{ fact: "hasActiveEmployees", guide: "addWorker" }],
    steps: [
      { id: "openPage", type: "navigate", target: "nav.workers", route: WORKERS },
      { id: "openModal", type: "click", target: "worker.timeoff", route: WORKERS },
      { id: "from", type: "input", target: "timeoff.from", route: WORKERS },
      { id: "to", type: "input", target: "timeoff.to", route: WORKERS },
      { id: "reason", type: "info", target: "timeoff.reason", route: WORKERS },
      {
        id: "save",
        type: "click",
        target: "timeoff.save",
        route: WORKERS,
        successTarget: "timeoff.added",
        errorTarget: "timeoff.error",
      },
      { id: "done", type: "info", route: WORKERS },
    ],
  },
  {
    // Reception's way in: the Time off page, for roles that plan the schedule
    // without managing staff.
    id: "timeOffReception",
    section: "schedule",
    // schedule.read opens the page, schedule.write lets them add to it.
    permissions: ["schedule.read", "schedule.write"],
    hideWith: "staff.manage",
    route: TIME_OFF,
    needs: [{ fact: "hasActiveEmployees", guide: "addWorker" }],
    steps: [
      { id: "openPage", type: "navigate", target: "nav.time-off", route: TIME_OFF },
      { id: "openModal", type: "click", target: "timeoff.manage", route: TIME_OFF },
      { id: "from", type: "input", target: "timeoff.from", route: TIME_OFF },
      { id: "to", type: "input", target: "timeoff.to", route: TIME_OFF },
      { id: "reason", type: "info", target: "timeoff.reason", route: TIME_OFF },
      {
        id: "save",
        type: "click",
        target: "timeoff.save",
        route: TIME_OFF,
        successTarget: "timeoff.added",
        errorTarget: "timeoff.error",
      },
      { id: "done", type: "info", route: TIME_OFF },
    ],
  },
  {
    id: "lunchBreak",
    section: "schedule",
    permissions: ["staff.manage"],
    route: WORKERS,
    needs: [{ fact: "hasActiveEmployees", guide: "addWorker" }],
    steps: [
      { id: "openPage", type: "navigate", target: "nav.workers", route: WORKERS },
      { id: "edit", type: "click", target: "worker.edit", route: WORKERS },
      { id: "breakOn", type: "input", target: "worker.break", route: WORKERS },
      { id: "breakTime", type: "info", target: "worker.hours", route: WORKERS },
      {
        id: "save",
        type: "click",
        target: "worker.save",
        route: WORKERS,
        awaitRemoval: true,
        errorTarget: "worker.error",
      },
      { id: "done", type: "info", route: WORKERS },
    ],
  },
  {
    id: "payPlan",
    section: "billing",
    permissions: ["billing.manage"],
    route: BILLING,
    steps: [
      { id: "openPage", type: "navigate", target: "nav.billing", route: BILLING },
      { id: "status", type: "info", target: "billing.status", route: BILLING },
      // Any plan's button will do, so the step points at the plans as a whole.
      { id: "pay", type: "click", target: "billing.plans", route: BILLING },
      { id: "done", type: "info", route: BILLING },
    ],
  },
] as const satisfies readonly GuideDef[];

export type GuideId = (typeof GUIDES)[number]["id"];

const BY_ID = new Map<string, GuideDef>(GUIDES.map((g) => [g.id, g]));

export function guideById(id: string): GuideDef | undefined {
  return BY_ID.get(id);
}

export function isGuideId(id: string): id is GuideId {
  return BY_ID.has(id);
}

/** Every data-tour value the guides point at, for the registry test. */
export function guideTargets(): string[] {
  const out = new Set<string>();
  for (const g of GUIDES as readonly GuideDef[]) {
    for (const s of g.steps) {
      if (s.target) out.add(s.target);
      if (s.errorTarget) out.add(s.errorTarget);
      if (s.successTarget) out.add(s.successTarget);
    }
  }
  return [...out];
}

/** Anchors the engine itself relies on, besides the guides' own targets. */
export const ENGINE_TARGETS = ["nav.menu"] as const;

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
// `permission` below and the plan, and handed to the client ready-made. The
// client never filters this list itself.
//
// PURE: no React, no Prisma. The server imports it to decide availability, the
// client to run the steps.

import type { Permission } from "../auth/permissions";

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
   * data-tour of the form's error line. When it shows up after the press, the
   * spotlight widens to it and the step says the save did not go through.
   */
  errorTarget?: string;
}

/** The help panel's groups, in display order. */
export const GUIDE_SECTIONS = ["services", "team", "schedule", "bookings", "billing"] as const;
export type GuideSection = (typeof GUIDE_SECTIONS)[number];

/**
 * A plan limit a guide can run into. The server counts it before the guide
 * starts, so a person is told up front instead of being walked into a refusal.
 */
export type GuideLimit = "employeeSeats";

export interface GuideDef {
  id: string;
  section: GuideSection;
  /** What the person must be allowed to do. Asked with accessRefusal(). */
  permission: Permission;
  /** The page the guide works on. */
  route: string;
  /** A plan limit the guide's action consumes, checked before it starts. */
  limit?: GuideLimit;
  /**
   * A guide that must have left something behind first. The add-on form cannot
   * be saved without a service to attach the add-on to. registry.test.ts checks
   * the id exists.
   */
  needs?: {
    /** Id of the guide that leaves it behind (a string here: GuideId derives from this list). */
    guide: string;
    fact: "hasServices";
  };
  steps: readonly GuideStep[];
}

export const GUIDES = [
  {
    id: "addService",
    section: "services",
    permission: "services.write",
    route: "/dashboard/services",
    steps: [
      { id: "openPage", type: "navigate", target: "nav.services", route: "/dashboard/services" },
      { id: "openForm", type: "click", target: "service.add", route: "/dashboard/services" },
      { id: "name", type: "input", target: "service.name", route: "/dashboard/services" },
      { id: "price", type: "input", target: "service.price", route: "/dashboard/services" },
      { id: "duration", type: "input", target: "service.duration", route: "/dashboard/services" },
      {
        id: "save",
        type: "click",
        target: "service.save",
        route: "/dashboard/services",
        awaitRemoval: true,
        errorTarget: "service.error",
      },
      { id: "done", type: "info", route: "/dashboard/services" },
    ],
  },
  {
    id: "addAddon",
    section: "services",
    permission: "services.write",
    route: "/dashboard/services",
    needs: { guide: "addService", fact: "hasServices" },
    steps: [
      { id: "openPage", type: "navigate", target: "nav.services", route: "/dashboard/services" },
      { id: "openForm", type: "click", target: "addon.add", route: "/dashboard/services" },
      { id: "name", type: "input", target: "addon.name", route: "/dashboard/services" },
      { id: "price", type: "input", target: "addon.price", route: "/dashboard/services" },
      { id: "services", type: "input", target: "addon.services", route: "/dashboard/services" },
      {
        id: "save",
        type: "click",
        target: "addon.save",
        route: "/dashboard/services",
        awaitRemoval: true,
        errorTarget: "addon.error",
      },
      { id: "done", type: "info", route: "/dashboard/services" },
    ],
  },
  {
    id: "addWorker",
    section: "team",
    permission: "staff.manage",
    route: "/dashboard/workers",
    limit: "employeeSeats",
    steps: [
      { id: "openPage", type: "navigate", target: "nav.workers", route: "/dashboard/workers" },
      { id: "openForm", type: "click", target: "worker.add", route: "/dashboard/workers" },
      { id: "name", type: "input", target: "worker.name", route: "/dashboard/workers" },
      { id: "services", type: "input", target: "worker.services", route: "/dashboard/workers" },
      { id: "hours", type: "info", target: "worker.hours", route: "/dashboard/workers" },
      {
        id: "save",
        type: "click",
        target: "worker.save",
        route: "/dashboard/workers",
        awaitRemoval: true,
        errorTarget: "worker.error",
      },
      { id: "done", type: "info", route: "/dashboard/workers" },
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
    }
  }
  return [...out];
}

/** Anchors the engine itself relies on, besides the guides' own targets. */
export const ENGINE_TARGETS = ["nav.menu"] as const;

"use server";

import { requirePermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

// The person's own first-run state: each action writes one field of the
// caller's OWN UserGuideState — no salon data is read or written — so the guard
// asks only that they are signed in to a salon with a login that works.
// bookings.read is held by every role that can sign in (permissions.test.ts).
//
// Guide analytics events are not here: they go by navigator.sendBeacon to
// /api/dashboard/guide-events (src/lib/guides/events.ts), which survives the
// page changing right after — a server action in flight does not.

// ── First-run state ─────────────────────────────────────────────────────────
// Each writes one field of the caller's own UserGuideState and nothing else.

/** The welcome dialog was closed (either button, or Escape): never show it again. */
export async function markWelcomeShown(): Promise<void> {
  const session = await requirePermission("bookings.read");
  const userId = session.user.id;
  const now = new Date();
  await prisma.userGuideState.upsert({
    where: { userId },
    create: { userId, welcomeShownAt: now },
    update: { welcomeShownAt: now },
  });
}

/** Skip the checklist on Today (true), or bring it back from the help panel (false). */
export async function setChecklistHidden(hidden: boolean): Promise<void> {
  const session = await requirePermission("bookings.read");
  if (typeof hidden !== "boolean") return;
  const userId = session.user.id;
  await prisma.userGuideState.upsert({
    where: { userId },
    create: { userId, checklistHidden: hidden },
    update: { checklistHidden: hidden },
  });
}

/**
 * A "Copy" button next to the salon's booking link was pressed — the Settings
 * card or the checklist's own. The first press is what counts; later ones
 * leave the date alone.
 */
export async function markLinkCopied(): Promise<void> {
  const session = await requirePermission("bookings.read");
  const userId = session.user.id;
  await prisma.userGuideState.upsert({
    where: { userId },
    create: { userId, linkCopiedAt: new Date() },
    update: {},
  });
  await prisma.userGuideState.updateMany({
    where: { userId, linkCopiedAt: null },
    data: { linkCopiedAt: new Date() },
  });
}

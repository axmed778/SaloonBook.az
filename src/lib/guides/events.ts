// Recording one interactive-guide analytics event for a signed-in person —
// shared by /api/dashboard/guide-events (where the client's beacons land).
// Server-only: Prisma.
//
// A lost event costs a data point, never a step, so nothing here throws at
// the person. Input is checked against the registry and rate-limited per
// user, because it is still a POST anyone signed in can send.

import { z } from "zod";
import { prisma } from "../prisma";
import { rateLimit } from "../ratelimit";
import { guideById } from "./registry";

export const GUIDE_EVENT = z.object({
  guideId: z.string().max(64),
  event: z.enum(["started", "completed", "abandoned"]),
  step: z.number().int().min(0).max(100),
  // exit: closed it; not_found: the step's element never appeared; timeout:
  // left mid-guide and not back within the resume window (reported on return).
  reason: z.enum(["exit", "not_found", "timeout"]).nullable(),
});

export type GuideEventInput = z.infer<typeof GUIDE_EVENT>;

/** Generous for a person clicking through guides, useless for filling a table. */
const EVENTS_PER_HOUR = 200;

/** Records it, or quietly does nothing for input that does not fit. */
export async function recordGuideEvent(userId: string, input: unknown): Promise<void> {
  const parsed = GUIDE_EVENT.safeParse(input);
  if (!parsed.success) return;
  const { guideId, event, step, reason } = parsed.data;
  const guide = guideById(guideId);
  if (!guide || step >= guide.steps.length) return;
  // A reason belongs to an abandon, and only to one.
  if ((event === "abandoned") !== (reason !== null)) return;

  const limit = await rateLimit(`guide-events:${userId}`, EVENTS_PER_HOUR, 3600);
  if (!limit.allowed) return;

  await prisma.guideEvent.create({ data: { userId, guideId, event, step, reason } });

  if (event === "completed") {
    // Kept as a set: finishing a guide twice records it once.
    const state = await prisma.userGuideState.findUnique({
      where: { userId },
      select: { completedGuides: true },
    });
    if (state?.completedGuides.includes(guideId)) return;
    await prisma.userGuideState.upsert({
      where: { userId },
      create: { userId, completedGuides: [guideId] },
      update: { completedGuides: { push: guideId } },
    });
  }
}

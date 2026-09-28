"use server";

import { z } from "zod";
import { requirePermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/ratelimit";
import { guideById } from "@/lib/guides/registry";

// The interactive guides' writes: analytics events, and the person's own
// progress. Everything here is about the caller's OWN user row — no salon data
// is read or written — so the guard asks only that they are signed in to a salon
// with a login that works. bookings.read is held by every role that can sign in
// (permissions.test.ts checks), which makes it that question.
//
// Fire-and-forget from the client: a lost event costs a data point, never a
// step, so nothing here throws at the person. Input is checked against the
// registry and rate-limited per user, because it is still a POST anyone signed
// in can send.

const EVENT = z.object({
  guideId: z.string().max(64),
  event: z.enum(["started", "completed", "abandoned"]),
  step: z.number().int().min(0).max(100),
  reason: z.enum(["exit", "not_found"]).nullable(),
});

export type GuideEventInput = z.infer<typeof EVENT>;

/** Generous for a person clicking through guides, useless for filling a table. */
const EVENTS_PER_HOUR = 200;

export async function recordGuideEvent(input: GuideEventInput): Promise<void> {
  const session = await requirePermission("bookings.read");
  const parsed = EVENT.safeParse(input);
  if (!parsed.success) return;
  const { guideId, event, step, reason } = parsed.data;
  const guide = guideById(guideId);
  if (!guide || step >= guide.steps.length) return;
  // A reason belongs to an abandon, and only to one.
  if ((event === "abandoned") !== (reason !== null)) return;

  const userId = session.user.id;
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

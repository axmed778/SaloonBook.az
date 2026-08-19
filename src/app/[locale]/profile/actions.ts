"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/auth/client-session";
import { acceptClientConsents } from "@/lib/legal-consent";

// Server actions for the client area. Every action re-derives the caller from the
// client session and scopes work to the session's VERIFIED phone — a phone is
// never accepted from the request (tenant isolation).

export type ReviewResult = { ok: true } | { ok: false; error: string };

const reviewSchema = z.object({
  appointmentId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
});

export async function submitReview(input: unknown): Promise<ReviewResult> {
  const session = await getClientSession();
  if (!session) return { ok: false, error: "unauthorized" };

  const parsed = reviewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const { appointmentId, rating, comment } = parsed.data;

  // The appointment must be COMPLETED and belong to a customer with THIS client's
  // verified phone. Scoping by session.phone (never a request value) is the
  // isolation guarantee — a client can only review their own visits.
  const appt = await prisma.appointment.findFirst({
    where: {
      id: appointmentId,
      status: "COMPLETED",
      customer: { phone: session.phone },
    },
    select: { id: true, salonId: true },
  });
  if (!appt) return { ok: false, error: "not_allowed" };

  try {
    await prisma.$transaction(async (tx) => {
      // create() enforces the one-review-per-appointment unique constraint.
      await tx.review.create({
        data: {
          clientId: session.id,
          salonId: appt.salonId,
          appointmentId: appt.id,
          rating,
          comment: comment || null,
        },
      });
      // Keep the salon's denormalized aggregate in step (drives the min-rating
      // filter). Same transaction, so the count/sum never drift from the rows.
      await tx.salon.update({
        where: { id: appt.salonId },
        data: { ratingCount: { increment: 1 }, ratingSum: { increment: rating } },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: "already_reviewed" };
    }
    console.error("[review] submit error", e);
    return { ok: false, error: "failed" };
  }

  revalidatePath("/profile/history");
  return { ok: true };
}

/**
 * Records this client's acceptance of the re-consent gate. Takes no input: the
 * subject comes from the session and the stale document set is re-derived from
 * the database, so nothing about the acceptance is caller-controlled.
 */
export async function acceptLegalConsents(): Promise<void> {
  const session = await getClientSession();
  if (!session) return;
  await acceptClientConsents(session.id);
  revalidatePath("/profile");
}

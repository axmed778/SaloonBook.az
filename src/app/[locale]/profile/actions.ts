"use server";

import { z } from "zod";
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getClientSession } from "@/lib/auth/client-session";
import { acceptClientConsents } from "@/lib/legal-consent";
import { applyRatingDelta } from "../_lib/salon-rating";

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
    select: { id: true, salonId: true, autoCompleted: true },
  });
  if (!appt) return { ok: false, error: "not_allowed" };

  // COMPLETED alone is not proof the visit happened. worker/processors/
  // reconcile.ts flips any CONFIRMED appointment older than 48h to COMPLETED so
  // revenue and payroll don't read zero, stamping autoCompleted — a no-show the
  // salon never got round to marking looks exactly like a finished visit.
  //
  // Reviews are public, render on the salon page, and feed ratingSum, which
  // drives the minimum-rating filter on the discovery map. Accepting them on
  // auto-completed rows meant anyone could verify a phone by OTP, book at a
  // competitor, not turn up, wait two days and leave a one-star review —
  // repeatably. The salon's only defence was marking the no-show by hand inside
  // the window. Require a human to have closed the visit.
  if (appt.autoCompleted) return { ok: false, error: "not_confirmed" };

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
      // Goes through the shared helper so add and remove stay symmetrical —
      // deleting a customer subtracts through the same delta path.
      await applyRatingDelta(tx, appt.salonId, 1, rating);
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

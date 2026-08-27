import type { Prisma } from "@prisma/client";

// ---------------------------------------------------------------------------
// Salon.ratingCount / Salon.ratingSum are a denormalized aggregate over Review
// rows: the star rating on the public salon page, the ordering on /salons and
// the minimum-rating filter on the discovery map all read the two columns
// instead of scanning reviews.
//
// The aggregate used to only ever grow — the review action incremented it and
// nothing anywhere decremented it. Reviews DO go away (deleting a customer
// takes their appointments, and therefore their reviews, with them), so their
// stars stayed counted forever and the published rating drifted permanently
// upward, on the salons with the most churn.
//
// Every path that adds, removes or changes a Review has to move the aggregate
// in the SAME transaction. These helpers are that single place, so a future
// path can't quietly forget again.
// ---------------------------------------------------------------------------

/**
 * Moves a salon's rating aggregate by a delta.
 *
 * Deltas, not absolutes: adding a review is (+1, +rating), removing one is
 * (-1, -rating), and editing a review in place is (0, newRating - oldRating) —
 * the adjustment, never a re-add.
 *
 * Raw UPDATE rather than a read-then-write for two reasons. It is a single
 * atomic statement (`SET x = x + n`), so two clients reviewing the same salon
 * at the same moment cannot lose each other's write the way "read the total,
 * compute, write it back" can. And GREATEST(0, ...) clamps at zero, so a salon
 * whose aggregate is already inflated or under-counted from historical drift
 * can never be pushed negative and start rendering a nonsensical rating.
 */
export async function applyRatingDelta(
  tx: Prisma.TransactionClient,
  salonId: string,
  countDelta: number,
  sumDelta: number,
): Promise<void> {
  if (countDelta === 0 && sumDelta === 0) return;
  await tx.$executeRaw`
    UPDATE "Salon"
       SET "ratingCount" = GREATEST(0, "ratingCount" + ${countDelta}::int),
           "ratingSum" = GREATEST(0, "ratingSum" + ${sumDelta}::int)
     WHERE "id" = ${salonId}
  `;
}

/**
 * Deletes every review one salon's customer left and subtracts exactly the
 * stars that went away. Returns how many rows were removed.
 *
 * DELETE ... RETURNING rather than "read the ratings, then deleteMany": one
 * statement, so a review landing between the read and the delete cannot be
 * removed without also being subtracted.
 *
 * Callers must run this BEFORE deleting the customer's appointments — the
 * Review.appointmentId relation is required, which Prisma maps to ON DELETE
 * RESTRICT, so pulling the appointments out from under a review raises 23503
 * and rolls the whole transaction back.
 */
export async function deleteCustomerReviews(
  tx: Prisma.TransactionClient,
  salonId: string,
  customerId: string,
): Promise<number> {
  // salonId is repeated on both sides deliberately: it is the tenant write
  // guard on Review, and it keeps the appointment lookup inside this salon too.
  const removed = await tx.$queryRaw<{ rating: number }[]>`
    DELETE FROM "Review"
     WHERE "salonId" = ${salonId}
       AND "appointmentId" IN (
         SELECT "id" FROM "Appointment"
          WHERE "salonId" = ${salonId} AND "customerId" = ${customerId}
       )
    RETURNING "rating"
  `;
  if (removed.length === 0) return 0;

  const stars = removed.reduce((sum, r) => sum + r.rating, 0);
  await applyRatingDelta(tx, salonId, -removed.length, -stars);
  return removed.length;
}

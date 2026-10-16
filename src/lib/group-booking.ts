// Group booking: one appointment for several people having the same service
// (and add-ons) with the same master, back to back — "3 friends, 1 h of
// manicure each" is ONE 3 h booking, not three. Client-safe: imported by the
// booking forms as well as the server.

/** Most people one booking may be for. The DB CHECK allows a little more. */
export const MAX_PEOPLE_PER_BOOKING = 10;

/**
 * Minutes a booking occupies the master: the per-person work (service +
 * add-ons) once per person, then the service's buffer once at the end — the
 * clean-up happens after the group, not between each of them.
 */
export function bookingBlockMin(args: {
  durationMin: number;
  extraMin?: number;
  bufferMin: number;
  people?: number;
}): number {
  return (args.durationMin + (args.extraMin ?? 0)) * peopleOrOne(args.people) + args.bufferMin;
}

/** A safe count: anything missing or nonsensical reads as one person. */
export function peopleOrOne(people: number | null | undefined): number {
  return Number.isInteger(people) && (people as number) > 1 ? (people as number) : 1;
}

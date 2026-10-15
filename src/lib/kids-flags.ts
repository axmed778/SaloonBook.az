import { prisma } from "./prisma";

// Server-only half of src/lib/kids.ts (which the booking widget imports, so it
// must not pull in Prisma): the kids flags for many salons at once, for the
// public discovery APIs.
//
// Not a nested `services: { take: 1 }` select: Prisma can't push a per-salon
// LIMIT into SQL when it loads many salons, so that read every active adult
// service of every salon and trimmed the list in memory.

/** `select` fragment: the salon's count of active kids' services. */
export const salonKidsCountSelect = {
  _count: { select: { services: { where: { isActive: true, forKids: true } } } },
} as const;

/**
 * Of these salons, the ones with at least one active adult service. One
 * grouped query, at most one row per salon. Callers pass only the salons that
 * have kids' services (usually few): for the rest kidsOnly is false anyway.
 */
export async function salonsWithAdultServices(salonIds: string[]): Promise<Set<string>> {
  if (salonIds.length === 0) return new Set();
  const rows = await prisma.service.groupBy({
    by: ["salonId"],
    where: { isActive: true, forKids: false, salonId: { in: salonIds } },
  });
  return new Set(rows.map((r) => r.salonId));
}

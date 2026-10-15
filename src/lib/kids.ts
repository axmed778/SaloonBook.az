// Children's services: an age axis next to the gender `audience` (see
// src/lib/audience.ts). A Service is either for adults or for kids (forKids);
// an Employee either takes children or not (worksWithKids). Kept out of the
// Audience enum on purpose: a child is still a boy or a girl, and a "KIDS"
// gender would make every audience check ambiguous.
//
// Nothing about kids is stored on Salon. Whether a salon "does kids", and
// whether it is a kids-only salon, is derived from its ACTIVE services.

import { matchesClientGender, type Audience } from "./audience";

/** Who an online booking is for: an adult of a gender, or a child. */
export type BookingClient = "MALE" | "FEMALE" | "KID";

export type KidsFlags = { hasKids: boolean; kidsOnly: boolean };

/**
 * The flags from two facts the discovery APIs read without loading a catalog:
 * how many active kids' services the salon has, and whether it has any active
 * adult service (see src/lib/kids-flags.ts).
 */
export function kidsFlagsFromCounts(kidsServices: number, hasAdultService: boolean): KidsFlags {
  const hasKids = kidsServices > 0;
  return { hasKids, kidsOnly: hasKids && !hasAdultService };
}

/** hasKids: at least one active kids' service. kidsOnly: every active service is. */
export function kidsFlags(services: { forKids: boolean }[]): KidsFlags {
  const hasKids = services.some((s) => s.forKids);
  return { hasKids, kidsOnly: hasKids && services.every((s) => s.forKids) };
}

/**
 * The "who is this booking for" choice a salon's booking form offers.
 *
 * - `options` — the buttons of the first step, or null when there is nothing to
 *   ask (the step is skipped).
 * - `fixed` — the client when the step is skipped.
 *
 * A salon without kids' services gets exactly what it had before: Men / Women
 * for a unisex salon, no step (its own gender) for a gendered one. With kids'
 * services a "Child" option is added; for a gendered salon the adult option is
 * the salon's gender (labelled "Adult"). A kids-only salon asks nothing.
 */
export function bookingClientSetup(
  salonAudience: Audience,
  services: { forKids: boolean }[],
): { options: BookingClient[] | null; fixed: BookingClient | null } {
  const { hasKids, kidsOnly } = kidsFlags(services);
  if (kidsOnly) return { options: null, fixed: "KID" };
  const adults: BookingClient[] = salonAudience === "ALL" ? ["MALE", "FEMALE"] : [salonAudience];
  const options: BookingClient[] = hasKids ? [...adults, "KID"] : adults;
  return options.length > 1 ? { options, fixed: null } : { options: null, fixed: options[0] };
}

/** Is this service offered to this client? Kids' services go to children only. */
export function serviceFitsClient(
  service: { audience: Audience; forKids: boolean },
  client: BookingClient,
): boolean {
  if (client === "KID") return service.forKids;
  return !service.forKids && matchesClientGender(service.audience, client);
}

/** Can this master take this client? For a child the gender audience doesn't apply. */
export function employeeFitsClient(
  employee: { audience: Audience; worksWithKids: boolean },
  client: BookingClient,
): boolean {
  if (client === "KID") return employee.worksWithKids;
  return matchesClientGender(employee.audience, client);
}

/**
 * The client a "book again" link can preselect, or null when it can't be
 * pinned (the customer then starts from the first step as usual). A kids'
 * service pins a child; otherwise the salon's gender, or the service's when
 * the salon is unisex. An ALL service at an ALL salon pins nothing.
 */
export function presetClientFor(
  salonAudience: Audience,
  service: { audience: Audience; forKids: boolean },
): BookingClient | null {
  if (service.forKids) return "KID";
  if (salonAudience !== "ALL") return salonAudience;
  return service.audience !== "ALL" ? service.audience : null;
}

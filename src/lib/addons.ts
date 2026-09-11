import type { Prisma } from "@prisma/client";
// Type-only: the pure helpers below are imported by client components too, so
// this module must never pull the Prisma client into a browser bundle.
import type { prisma } from "./prisma";

// Service add-ons ("French +5 ₼", "Nail art +3 ₼"): optional extras booked on top
// of a main service. Their prices and minutes are ADDED to the booking's — see
// createBooking — and each chosen one is copied onto the appointment
// (AppointmentAddon) so later catalog edits never rewrite a past booking.

/** A Prisma client or an interactive-transaction client. */
type Db = typeof prisma | Prisma.TransactionClient;

/** Most add-ons one booking may carry. Bounds the request, not the catalog. */
export const MAX_ADDONS_PER_BOOKING = 10;

/** An add-on as it goes onto a booking: the catalog row at this moment. */
export interface ChosenAddon {
  id: string;
  name: string;
  priceMinor: number;
  durationMin: number;
}

/** The requested add-ons can't all be booked with this service: one was
 *  deactivated or unlinked since the page loaded, or never belonged here. */
export class AddonUnavailableError extends Error {
  constructor() {
    super("One of the chosen add-ons is no longer available.");
    this.name = "AddonUnavailableError";
  }
}

/**
 * Resolves the add-on ids a caller asked for into the catalog rows that will be
 * booked. Every id must be an ACTIVE add-on of THIS salon linked to THIS
 * service. Anything else refuses the whole request (null) rather than quietly
 * dropping the bad id: the customer was shown a total that included it.
 */
export async function resolveAddons(
  db: Db,
  args: { salonId: string; serviceId: string; addonIds?: string[] },
): Promise<ChosenAddon[] | null> {
  const ids = [...new Set(args.addonIds ?? [])];
  if (ids.length === 0) return [];
  if (ids.length > MAX_ADDONS_PER_BOOKING) return null;

  const rows = await db.serviceAddon.findMany({
    where: {
      id: { in: ids },
      salonId: args.salonId,
      isActive: true,
      services: { some: { serviceId: args.serviceId } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, priceMinor: true, durationMin: true },
  });
  return rows.length === ids.length ? rows : null;
}

/** What a set of add-ons adds to the booking: money and minutes. */
export function addonTotals(addons: ReadonlyArray<{ priceMinor: number; durationMin: number }>): {
  priceMinor: number;
  durationMin: number;
} {
  let priceMinor = 0;
  let durationMin = 0;
  for (const a of addons) {
    priceMinor += a.priceMinor;
    durationMin += a.durationMin;
  }
  return { priceMinor, durationMin };
}

/**
 * Everything booked, as one line — "Manikür + Gellak + French + Nail art". For
 * the surfaces with a single "service" slot: WhatsApp template parameters, push
 * notifications, the today list. Screens with room list the add-ons separately.
 */
export function serviceWithAddons(serviceName: string, addonNames: readonly string[]): string {
  return [serviceName, ...addonNames].join(" + ");
}

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Public feed for the landing-page discovery map: every ACTIVE salon (branch)
// that has pinned a location. Only data that is already public on the salon's
// own booking page is exposed here — name, address, coordinates, audience and
// the slug that links straight to booking. No auth: discovery is the point.
//
// Each branch is its own Salon row with its own pin + slug, so multi-branch
// accounts naturally show one marker per bookable location.
export async function GET() {
  const rows = await prisma.salon.findMany({
    where: {
      status: "ACTIVE",
      latitude: { not: null },
      longitude: { not: null },
    },
    select: {
      slug: true,
      name: true,
      address: true,
      audience: true,
      latitude: true,
      longitude: true,
    },
    // Generous cap — this is a small-country directory, not a global one.
    take: 1000,
  });

  const salons = rows.map((s) => ({
    slug: s.slug,
    name: s.name,
    address: s.address,
    audience: s.audience,
    lat: s.latitude as number,
    lng: s.longitude as number,
  }));

  return NextResponse.json(
    { salons },
    // Short shared-cache window: the directory changes rarely and a slightly
    // stale marker set is harmless, but keeps this off the DB under load.
    { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
  );
}

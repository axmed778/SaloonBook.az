import { NextRequest, NextResponse } from "next/server";
import type { ServiceCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseBusinessHours } from "@/lib/business-hours";
import { bakuToday, bakuWeekday, bakuMinutesOfDay } from "@/lib/time";

export const dynamic = "force-dynamic";

// Viewport search for the discovery map: ACTIVE, pinned salons inside a bounding
// box, with optional filters. Hard-limited; `truncated` tells the client to zoom
// in. Only already-public salon data is returned. The viewport comes from the
// client's map — no location is persisted here.

const HARD_LIMIT = 300;
const CATEGORIES = new Set<ServiceCategory>([
  "HAIR",
  "NAILS",
  "BROWS_LASHES",
  "MAKEUP",
  "SPA",
  "BARBER",
  "OTHER",
]);

type Bbox = { west: number; south: number; east: number; north: number };

// "west,south,east,north" (lng,lat,lng,lat).
function parseBbox(raw: string | null): Bbox | null {
  if (!raw) return null;
  const p = raw.split(",").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isFinite(n))) return null;
  const [west, south, east, north] = p;
  if (south > north || west > east) return null;
  if (south < -90 || north > 90 || west < -180 || east > 180) return null;
  return { west, south, east, north };
}

function isOpenNow(businessHours: unknown): boolean {
  const hours = parseBusinessHours(businessHours);
  if (hours.length === 0) return false;
  const weekday = bakuWeekday(bakuToday());
  const mins = bakuMinutesOfDay(new Date());
  return hours.some((h) => h.weekday === weekday && h.openMin <= mins && mins < h.closeMin);
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  const bbox = parseBbox(sp.get("bbox"));
  if (!bbox) return NextResponse.json({ error: "invalid_bbox" }, { status: 400 });

  const catRaw = sp.get("category");
  const category =
    catRaw && CATEGORIES.has(catRaw as ServiceCategory) ? (catRaw as ServiceCategory) : null;
  const openNow = sp.get("openNow") === "1" || sp.get("openNow") === "true";
  const minRatingRaw = Number(sp.get("minRating"));
  const minRating =
    Number.isFinite(minRatingRaw) && minRatingRaw > 0 ? Math.min(5, minRatingRaw) : 0;

  const rows = await prisma.salon.findMany({
    where: {
      status: "ACTIVE",
      latitude: { gte: bbox.south, lte: bbox.north },
      longitude: { gte: bbox.west, lte: bbox.east },
      ...(category ? { services: { some: { category, isActive: true } } } : {}),
    },
    select: {
      slug: true,
      name: true,
      address: true,
      district: true,
      latitude: true,
      longitude: true,
      audience: true,
      ratingCount: true,
      ratingSum: true,
      businessHours: true,
    },
    // +1 to detect truncation.
    take: HARD_LIMIT + 1,
  });

  const truncated = rows.length > HARD_LIMIT;
  const limited = truncated ? rows.slice(0, HARD_LIMIT) : rows;

  const salons = limited
    .filter((s) => {
      if (minRating > 0 && !(s.ratingCount > 0 && s.ratingSum / s.ratingCount >= minRating)) {
        return false;
      }
      if (openNow && !isOpenNow(s.businessHours)) return false;
      return true;
    })
    .map((s) => ({
      slug: s.slug,
      name: s.name,
      address: s.address,
      district: s.district,
      audience: s.audience,
      lat: s.latitude as number,
      lng: s.longitude as number,
      rating: s.ratingCount > 0 ? Math.round((s.ratingSum / s.ratingCount) * 10) / 10 : null,
      ratingCount: s.ratingCount,
    }));

  return NextResponse.json(
    { salons, truncated },
    // Short shared-cache window keyed on the query string; viewport-specific.
    { headers: { "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120" } },
  );
}

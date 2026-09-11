import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAvailableSlots } from "@/lib/availability";
import { addonTotals, resolveAddons, MAX_ADDONS_PER_BOOKING } from "@/lib/addons";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Read-only, so a looser cap than /book — just enough to stop scraping/abuse.
const AVAIL_LIMIT = { limit: 60, windowSec: 60 } as const; // 60 req / min / IP

const querySchema = z.object({
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Baku calendar day
  // Chosen add-ons, comma-separated. They lengthen the booking, so the slots
  // offered must be the ones the longer booking actually fits.
  addonIds: z.array(z.string().uuid()).max(MAX_ADDONS_PER_BOOKING),
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const ip = clientIp(req);
  const rl = await rateLimit(`avail:ip:${ip}`, AVAIL_LIMIT.limit, AVAIL_LIMIT.windowSec);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } },
    );
  }

  const parsed = querySchema.safeParse({
    serviceId: req.nextUrl.searchParams.get("serviceId"),
    employeeId: req.nextUrl.searchParams.get("employeeId"),
    date: req.nextUrl.searchParams.get("date"),
    addonIds: (req.nextUrl.searchParams.get("addonIds") ?? "").split(",").filter(Boolean),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
  }

  // Confirm the service & employee belong to this salon AND that the employee
  // can perform the service (mirrors the /book tenant check). Validating the
  // employee alone would let a crafted request compute slots from another
  // tenant's service duration/buffer.
  const salon = await prisma.salon.findUnique({ where: { slug }, select: { id: true } });
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });

  const link = await prisma.serviceEmployee.findFirst({
    where: {
      serviceId: parsed.data.serviceId,
      employeeId: parsed.data.employeeId,
      service: { salonId: salon.id, isActive: true },
      employee: { salonId: salon.id, isActive: true },
    },
    select: { serviceId: true },
  });
  if (!link) {
    return NextResponse.json(
      { error: "Invalid service or employee for this salon" },
      { status: 404 },
    );
  }

  // Same tenant rule as above: an add-on counts only if it is this salon's,
  // active, and offered with this service.
  const addons = await resolveAddons(prisma, {
    salonId: salon.id,
    serviceId: parsed.data.serviceId,
    addonIds: parsed.data.addonIds,
  });
  if (!addons) {
    return NextResponse.json(
      { error: "Invalid add-ons for this service", code: "ADDON_UNAVAILABLE" },
      { status: 422 },
    );
  }

  const slots = await getAvailableSlots({
    employeeId: parsed.data.employeeId,
    serviceId: parsed.data.serviceId,
    dayYmd: parsed.data.date,
    extraMin: addonTotals(addons).durationMin,
  });

  return NextResponse.json({ date: parsed.data.date, slots });
}

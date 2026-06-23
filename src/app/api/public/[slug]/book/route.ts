import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createBooking, SlotTakenError, PlanLimitError } from "@/lib/booking";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid(),
  startUtc: z.string().datetime(), // ISO instant from the availability response
  name: z.string().min(1).max(120),
  phone: z
    .string()
    .regex(/^\+994\d{9}$/, "Phone must be in +994XXXXXXXXX format"),
  waOptIn: z.boolean().optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  const salon = await prisma.salon.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!salon || salon.status !== "ACTIVE") {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // Confirm the employee can perform the service, in this salon.
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
    return NextResponse.json({ error: "This employee can't perform that service" }, { status: 400 });
  }

  try {
    const result = await createBooking({
      salonId: salon.id,
      serviceId: parsed.data.serviceId,
      employeeId: parsed.data.employeeId,
      startUtc: new Date(parsed.data.startUtc),
      customer: { name: parsed.data.name, phone: parsed.data.phone, waOptIn: parsed.data.waOptIn },
      source: "PUBLIC",
    });
    return NextResponse.json({
      ok: true,
      appointmentId: result.appointmentId,
      startUtc: result.startUtc.toISOString(),
    });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof PlanLimitError) {
      return NextResponse.json({ error: e.message, code: "PLAN_LIMIT" }, { status: 402 });
    }
    console.error("[book] error", e);
    return NextResponse.json({ error: "Could not create booking" }, { status: 500 });
  }
}

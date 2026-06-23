import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAvailableSlots } from "@/lib/availability";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // Baku calendar day
});

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const parsed = querySchema.safeParse({
    serviceId: req.nextUrl.searchParams.get("serviceId"),
    employeeId: req.nextUrl.searchParams.get("employeeId"),
    date: req.nextUrl.searchParams.get("date"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query", issues: parsed.error.issues }, { status: 400 });
  }

  // Confirm the service & employee belong to this salon (tenant safety).
  const salon = await prisma.salon.findUnique({ where: { slug }, select: { id: true } });
  if (!salon) return NextResponse.json({ error: "Salon not found" }, { status: 404 });

  const employee = await prisma.employee.findFirst({
    where: { id: parsed.data.employeeId, salonId: salon.id, isActive: true },
    select: { id: true },
  });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const slots = await getAvailableSlots({
    employeeId: parsed.data.employeeId,
    serviceId: parsed.data.serviceId,
    dayYmd: parsed.data.date,
  });

  return NextResponse.json({ date: parsed.data.date, slots });
}

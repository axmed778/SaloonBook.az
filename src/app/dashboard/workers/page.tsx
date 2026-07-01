import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { WorkersManager } from "./workers-manager";

export const dynamic = "force-dynamic";

export default async function WorkersPage() {
  const session = (await getSession())!;
  if (!session.salonId) {
    return <p className="text-sm text-zinc-400">Bu hesaba salon bağlanmayıb.</p>;
  }
  const salonId = session.salonId;

  const [employees, services] = await Promise.all([
    prisma.employee.findMany({
      where: { salonId },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        position: true,
        phone: true,
        isActive: true,
        audience: true,
        services: { select: { serviceId: true } },
        workingHours: { select: { weekday: true, startMin: true, endMin: true } },
      },
    }),
    prisma.service.findMany({
      where: { salonId },
      orderBy: { name: "asc" },
      select: { id: true, name: true, isActive: true },
    }),
  ]);

  const employeeRows = employees.map((e) => ({
    id: e.id,
    name: e.name,
    position: e.position,
    phone: e.phone,
    isActive: e.isActive,
    audience: e.audience,
    serviceIds: e.services.map((s) => s.serviceId),
    hours: e.workingHours.map((h) => ({
      weekday: h.weekday,
      startMin: h.startMin,
      endMin: h.endMin,
    })),
  }));

  return <WorkersManager employees={employeeRows} services={services} />;
}

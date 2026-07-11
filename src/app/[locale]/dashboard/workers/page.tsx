import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuYmd, formatBakuDate, shiftYmd } from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { WorkersManager } from "./workers-manager";

export const dynamic = "force-dynamic";

export default async function WorkersPage() {
  const session = (await getSession())!;
  if (!session.salonId) {
    const t = await getTranslations("Dashboard");
    return <p className="text-sm text-zinc-400">{t("noSalonLinked")}</p>;
  }
  const salonId = session.salonId;
  const df = intlLocale(await getLocale());

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
        // Current + upcoming time off (past entries don't matter for planning).
        timeOff: {
          where: { endsAt: { gt: new Date() } },
          orderBy: { startsAt: "asc" },
          select: { id: true, startsAt: true, endsAt: true, reason: true },
        },
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
    timeOff: e.timeOff.map((t) => {
      // endsAt is exclusive (start of the day after the last day off).
      const fromYmd = bakuYmd(t.startsAt);
      const toYmd = shiftYmd(bakuYmd(t.endsAt), -1);
      return {
        id: t.id,
        label:
          fromYmd === toYmd
            ? formatBakuDate(fromYmd, df)
            : `${formatBakuDate(fromYmd, df)} – ${formatBakuDate(toYmd, df)}`,
        reason: t.reason,
      };
    }),
  }));

  return <WorkersManager employees={employeeRows} services={services} />;
}

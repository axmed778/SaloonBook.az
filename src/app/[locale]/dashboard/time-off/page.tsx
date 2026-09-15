import { getTranslations, getLocale } from "next-intl/server";
import { requirePagePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { intlLocale } from "@/i18n/format";
import { timeOffRows } from "../_components/time-off-rows";
import { TimeOffBoard } from "./time-off-board";

export const dynamic = "force-dynamic";

// Time off without staff management: the screen reception plans the week on. It
// shows each active employee's name and position and nothing else about them —
// no phones, no login emails — which is why it is a page of its own rather than
// the Staff screen with parts hidden.
export default async function TimeOffPage() {
  const session = await requirePagePermission("schedule.read");
  if (!session.salonId) {
    const t = await getTranslations("Dashboard");
    return <p className="text-sm text-muted-foreground">{t("noSalonLinked")}</p>;
  }
  const df = intlLocale(await getLocale());

  const employees = await prisma.employee.findMany({
    where: { salonId: session.salonId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      position: true,
      timeOff: {
        where: { endsAt: { gt: new Date() } },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, endsAt: true, reason: true },
      },
    },
  });

  return (
    <TimeOffBoard
      employees={employees.map((e) => ({
        id: e.id,
        name: e.name,
        position: e.position,
        timeOff: timeOffRows(e.timeOff, df),
      }))}
      canEdit={can(session, "schedule.write")}
    />
  );
}

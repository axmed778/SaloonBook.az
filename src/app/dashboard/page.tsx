import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  bakuToday,
  bakuDayBoundsUtc,
  bakuMinutesOfDay,
  shiftYmd,
  formatBakuDate,
} from "@/lib/time";
import {
  Calendar,
  DAY_START_MIN,
  DAY_END_MIN,
  type CalendarBlock,
} from "./_components/calendar";

export const dynamic = "force-dynamic";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string }>;
}) {
  // The layout already guarantees a session (redirects otherwise).
  const session = (await getSession())!;

  // Platform admins don't own a salon calendar; that panel comes later.
  if (session.isAdmin || !session.salonId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold text-zinc-100">
          {session.isAdmin ? "Platforma idarəetməsi" : "Salon tapılmadı"}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          {session.isAdmin
            ? "Admin panel (planların aktivləşdirilməsi, dəvətlər) növbəti addımlarda əlavə olunacaq."
            : "Hesabınıza salon bağlanmayıb. Zəhmət olmasa dəstək ilə əlaqə saxlayın."}
        </p>
      </div>
    );
  }

  const salonId = session.salonId;
  const { day: dayParam } = await searchParams;
  const day = dayParam && YMD_RE.test(dayParam) ? dayParam : bakuToday();
  const { startUtc, endUtc } = bakuDayBoundsUtc(day);

  const [columns, appointments] = await Promise.all([
    prisma.employee.findMany({
      where: { salonId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, position: true },
    }),
    prisma.appointment.findMany({
      where: {
        salonId,
        status: { not: "CANCELLED" },
        startsAt: { gte: startUtc, lt: endUtc },
      },
      orderBy: { startsAt: "asc" },
      select: {
        id: true,
        employeeId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        service: { select: { name: true } },
        customer: { select: { name: true } },
      },
    }),
  ]);

  const blocks: CalendarBlock[] = appointments
    .filter((a) => a.status !== "CANCELLED")
    .map((a) => {
      // Clamp to the visible window so long/edge bookings still render sensibly.
      const startMin = Math.max(bakuMinutesOfDay(a.startsAt), DAY_START_MIN);
      const endMin = Math.min(bakuMinutesOfDay(a.endsAt), DAY_END_MIN);
      return {
        id: a.id,
        columnId: a.employeeId,
        startMin,
        endMin,
        title: a.service.name,
        subtitle: a.customer.name,
        status: a.status as CalendarBlock["status"],
      };
    })
    .filter((b) => b.endMin > b.startMin);

  return (
    <Calendar
      day={day}
      prevDay={shiftYmd(day, -1)}
      nextDay={shiftYmd(day, 1)}
      dateLabel={formatBakuDate(day)}
      isToday={day === bakuToday()}
      columns={columns}
      blocks={blocks}
    />
  );
}

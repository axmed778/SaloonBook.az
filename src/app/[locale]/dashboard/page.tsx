import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { intlLocale } from "@/i18n/format";
import {
  BAKU_TZ,
  bakuToday,
  bakuDayBoundsUtc,
  bakuMinutesOfDay,
  bakuYmd,
  bakuWeekday,
  shiftYmd,
  formatBakuDate,
} from "@/lib/time";
import { Calendar } from "./_components/calendar";
import {
  DAY_START_MIN,
  DAY_END_MIN,
  type CalendarBlock,
  type CalendarColumn,
  type CatalogEmployee,
  type WeekDay,
} from "./_components/calendar-shared";

export const dynamic = "force-dynamic";

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// Appointment fields the calendar needs, shared by the day and week queries.
const APPT_SELECT = {
  id: true,
  employeeId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  priceMinor: true,
  source: true,
  manageToken: true,
  service: { select: { name: true } },
  employee: { select: { name: true } },
  customer: { select: { name: true, phone: true } },
} as const;

type ApptRow = {
  id: string;
  employeeId: string;
  startsAt: Date;
  endsAt: Date;
  status: string;
  priceMinor: number;
  source: string;
  manageToken: string;
  service: { name: string };
  employee: { name: string };
  customer: { name: string; phone: string };
};

function toBlock(a: ApptRow, columnId: string, dateLabel: string): CalendarBlock {
  return {
    id: a.id,
    columnId,
    // Clamp to the visible window so long/edge bookings still render sensibly.
    startMin: Math.max(bakuMinutesOfDay(a.startsAt), DAY_START_MIN),
    endMin: Math.min(bakuMinutesOfDay(a.endsAt), DAY_END_MIN),
    title: a.service.name,
    subtitle: a.customer.name,
    status: a.status as CalendarBlock["status"],
    priceMinor: a.priceMinor,
    customerPhone: a.customer.phone,
    source: a.source,
    manageToken: a.manageToken,
    employeeName: a.employee.name,
    dateLabel,
  };
}

function weekDayLabels(ymd: string, df: string): { weekdayLabel: string; dayLabel: string } {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return {
    weekdayLabel: new Intl.DateTimeFormat(df, {
      timeZone: BAKU_TZ,
      weekday: "short",
    }).format(dt),
    dayLabel: new Intl.DateTimeFormat(df, {
      timeZone: BAKU_TZ,
      day: "numeric",
      month: "short",
    }).format(dt),
  };
}

// Baku Monday that starts the week containing `ymd` (weekday: 0=Sun..6=Sat).
function weekStartOf(ymd: string): string {
  const offset = (bakuWeekday(ymd) + 6) % 7;
  return shiftYmd(ymd, -offset);
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ day?: string; view?: string }>;
}) {
  // The layout already guarantees a session (redirects otherwise).
  const session = (await getSession())!;
  const locale = await getLocale();
  const df = intlLocale(locale);
  const t = await getTranslations("Dashboard");

  // Platform admins manage accounts, not a salon calendar.
  if (session.isAdmin) redirect({ href: "/dashboard/admin", locale });
  if (!session.salonId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold text-zinc-100">{t("noSalonTitle")}</h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          {t("noSalonBody")}
        </p>
      </div>
    );
  }

  const salonId = session.salonId;
  const { day: dayParam, view: viewParam } = await searchParams;
  const view = viewParam === "week" ? "week" : "day";
  const today = bakuToday();
  const day = dayParam && YMD_RE.test(dayParam) ? dayParam : today;

  // Catalog for the manual-booking form: active employees + the active services
  // each can perform. Doubles as the day-view column list.
  const employees = await prisma.employee.findMany({
    where: { salonId, isActive: true },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      position: true,
      services: {
        where: { service: { isActive: true } },
        select: {
          service: {
            select: { id: true, name: true, priceMinor: true, durationMin: true },
          },
        },
      },
    },
  });

  const columns: CalendarColumn[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    position: e.position,
  }));
  const catalog: CatalogEmployee[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    services: e.services.map((s) => s.service),
  }));

  if (view === "week") {
    const weekStart = weekStartOf(day);
    const weekEnd = shiftYmd(weekStart, 6);
    const { startUtc } = bakuDayBoundsUtc(weekStart);
    const { endUtc } = bakuDayBoundsUtc(weekEnd);

    const appts = (await prisma.appointment.findMany({
      where: {
        salonId,
        status: { not: "CANCELLED" },
        startsAt: { gte: startUtc, lt: endUtc },
      },
      orderBy: { startsAt: "asc" },
      select: APPT_SELECT,
    })) as ApptRow[];

    const weekDays: WeekDay[] = Array.from({ length: 7 }, (_, i) => {
      const ymd = shiftYmd(weekStart, i);
      return { ymd, ...weekDayLabels(ymd, df), isToday: ymd === today };
    });

    const blocks = appts
      .map((a) => {
        const ymd = bakuYmd(a.startsAt);
        return toBlock(a, ymd, formatBakuDate(ymd, df));
      })
      .filter((b) => b.endMin > b.startMin);

    return (
      <Calendar
        view="week"
        day={day}
        today={today}
        periodLabel={`${weekDayLabels(weekStart, df).dayLabel} – ${formatBakuDate(weekEnd, df)}`}
        columns={columns}
        weekDays={weekDays}
        blocks={blocks}
        catalog={catalog}
      />
    );
  }

  // --- Day view ---
  const { startUtc, endUtc } = bakuDayBoundsUtc(day);
  const dateLabel = formatBakuDate(day, df);
  const appts = (await prisma.appointment.findMany({
    where: {
      salonId,
      status: { not: "CANCELLED" },
      startsAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { startsAt: "asc" },
    select: APPT_SELECT,
  })) as ApptRow[];

  const blocks = appts
    .map((a) => toBlock(a, a.employeeId, dateLabel))
    .filter((b) => b.endMin > b.startMin);

  return (
    <Calendar
      view="day"
      day={day}
      today={today}
      periodLabel={dateLabel}
      columns={columns}
      weekDays={[]}
      blocks={blocks}
      catalog={catalog}
    />
  );
}

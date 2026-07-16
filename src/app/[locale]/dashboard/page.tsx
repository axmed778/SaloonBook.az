import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { intlLocale } from "@/i18n/format";
import {
  BAKU_TZ,
  bakuToday,
  bakuDayBoundsUtc,
  bakuMinutesOfDayOn,
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
  employee: { select: { name: true, position: true } },
  customer: { select: { name: true, phone: true } },
  attendeeName: true,
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
  employee: { name: string; position: string | null };
  customer: { name: string; phone: string };
  attendeeName: string | null;
};

const MINUTES_IN_DAY = 24 * 60;

function toBlock(a: ApptRow, columnId: string, dateLabel: string): CalendarBlock {
  // Keep the REAL, unclamped minutes so labels/popup show the true times; the
  // grid derives its visible window from the data. Both ends are measured
  // against the START day's midnight so a booking that runs to/past midnight
  // keeps its real height (bakuMinutesOfDay would wrap the end back to ~0).
  const startYmd = bakuYmd(a.startsAt);
  const startMin = bakuMinutesOfDayOn(a.startsAt, startYmd);
  const endMin = Math.min(bakuMinutesOfDayOn(a.endsAt, startYmd), MINUTES_IN_DAY);
  return {
    id: a.id,
    columnId,
    startMin,
    endMin,
    title: a.service.name,
    // Show who the booking is for; the phone stays the contact's.
    subtitle: a.attendeeName ?? a.customer.name,
    status: a.status as CalendarBlock["status"],
    // Past-due but still CONFIRMED → needs closing (completed / no-show).
    overdue: a.status === "CONFIRMED" && a.endsAt.getTime() < Date.now(),
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

// Visible time window for the grid: the default 08:00–22:00, widened (snapped to
// the hour) to include any booking that falls outside it — so late/early
// appointments stay visible instead of being clamped away.
function visibleWindow(blocks: CalendarBlock[]): { startMin: number; endMin: number } {
  let startMin = DAY_START_MIN;
  let endMin = DAY_END_MIN;
  for (const b of blocks) {
    if (b.startMin < startMin) startMin = b.startMin;
    if (b.endMin > endMin) endMin = b.endMin;
  }
  return {
    startMin: Math.max(0, Math.floor(startMin / 60) * 60),
    endMin: Math.min(MINUTES_IN_DAY, Math.ceil(endMin / 60) * 60),
  };
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
        <h1 className="text-xl font-semibold text-foreground">{t("noSalonTitle")}</h1>
        <p className="mt-2 max-w-sm text-sm text-faint-foreground">
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
    const win = visibleWindow(blocks);

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
        windowStartMin={win.startMin}
        windowEndMin={win.endMin}
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
  const win = visibleWindow(blocks);

  // Deactivated employees are excluded from the column list, but their existing
  // appointments still occupy the day. Surface those employees as greyed columns
  // so their confirmed customers stay visible (they'd otherwise vanish from the
  // day view while still getting reminders and showing up). The catalog above
  // stays active-only — you can't book NEW appointments for a deactivated one.
  const activeIds = new Set(columns.map((c) => c.id));
  const inactiveCols = new Map<string, CalendarColumn>();
  for (const a of appts) {
    if (!activeIds.has(a.employeeId) && !inactiveCols.has(a.employeeId)) {
      inactiveCols.set(a.employeeId, {
        id: a.employeeId,
        name: a.employee.name,
        position: a.employee.position,
        inactive: true,
      });
    }
  }
  const dayColumns = inactiveCols.size ? [...columns, ...inactiveCols.values()] : columns;

  return (
    <Calendar
      view="day"
      day={day}
      today={today}
      periodLabel={dateLabel}
      columns={dayColumns}
      weekDays={[]}
      blocks={blocks}
      catalog={catalog}
      windowStartMin={win.startMin}
      windowEndMin={win.endMin}
    />
  );
}

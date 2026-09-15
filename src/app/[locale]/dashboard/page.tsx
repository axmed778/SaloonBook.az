import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requirePagePermission } from "@/lib/auth/guards";
import { appointmentScope, salonScopeFor } from "@/lib/auth/access";
import { can } from "@/lib/auth/permissions";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuDayBoundsUtc, formatBakuDate } from "@/lib/time";
import {
  bookingSelectForViewer,
  bookingViewer,
  canSeePayments,
  serializeBookingsForViewer,
  type BookingRow,
} from "@/lib/serializers/booking";
import { dayTotalsByMethod, type DayTotals } from "./_components/today-shared";
import { TodayView } from "./_components/today-view";
import { toTodayAppointment, type TodayAppointment } from "./_components/today-shared";

export const dynamic = "force-dynamic";

// Phone-first landing: today's appointments as a chronological, thumb-friendly
// list ("Bu gün"). The full day/week grid moved to /dashboard/calendar.
//
// Every role lands here, and requirePagePermission() sends a refused role back
// here. It asks for bookings.read like the calendar does; every role holds it
// (permissions.test.ts checks), so that redirect can never point back at itself.
export default async function DashboardTodayPage() {
  const session = await requirePagePermission("bookings.read");
  const locale = await getLocale();
  const t = await getTranslations("Dashboard");

  // Platform admins manage accounts, not a salon.
  if (session.isAdmin) redirect({ href: "/dashboard/admin", locale });

  // A master's dashboard is their own column and nothing else. `scope` carries
  // that as data (null employeeId = the whole salon), so every query below is
  // narrowed the same way the server actions are. No scope — no salon, or a
  // master's login with no employee behind it — shows the empty state instead of
  // widening to the whole salon.
  const scope = session.salonId
    ? salonScopeFor({
        salonId: session.salonId,
        appRole: session.appRole,
        employeeId: session.employeeId,
      })
    : null;
  if (!scope) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold text-foreground">{t("noSalonTitle")}</h1>
        <p className="mt-2 max-w-sm text-sm text-faint-foreground">{t("noSalonBody")}</p>
      </div>
    );
  }

  const salonId = scope.salonId;
  // ...and `viewer` decides WHICH COLUMNS of those rows exist at all: a master's
  // query never reads the customer's phone, so nothing downstream — this page,
  // the RSC payload, the client component — can leak it.
  const viewer = bookingViewer(session);
  // Whether the payment rows are read at all. A master's query does not select
  // them, so no amount reaches this page or the payload it streams.
  const showPayments = canSeePayments(session);
  const today = bakuToday();
  const { startUtc, endUtc } = bakuDayBoundsUtc(today);
  const now = Date.now();

  // Salon name for the WhatsApp message templates on each row.
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true },
  });

  // Today's bookings, chronological. CANCELLED are excluded (same as the calendar).
  const appts = (await prisma.appointment.findMany({
    where: {
      ...appointmentScope(scope),
      status: { not: "CANCELLED" },
      startsAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { startsAt: "asc" },
    select: bookingSelectForViewer(viewer, { payments: showPayments }),
  })) as BookingRow[];

  const items: TodayAppointment[] = serializeBookingsForViewer(appts, viewer, {
    payments: showPayments,
  }).map((b) => toTodayAppointment(b, now));

  // Today's takings by method, for the header strip. Keyed on the PAYMENT day
  // (businessDate), not the booking day: this is what is in the drawer right
  // now, which is also why it is not revenue and does not use revenue.ts.
  //
  // Deliberately NOT the shift card — phase 3 replaces this with one. It is a
  // plain total with no open/closed state and no counted-vs-expected.
  let totals: DayTotals | null = null;
  if (showPayments) {
    const rows = await prisma.appointmentPayment.findMany({
      where: { salonId, businessDate: today },
      // Voided rows are read too, and dayTotalsByMethod drops them: deciding
      // what counts is the rule functions' job, not a query's.
      select: {
        kind: true,
        method: true,
        amountMinor: true,
        discountMinor: true,
        tipMinor: true,
        voidedAt: true,
      },
    });
    totals = dayTotalsByMethod(rows);
  }

  return (
    <TodayView
      items={items}
      dateLabel={formatBakuDate(today, locale)}
      salonName={salon?.name ?? ""}
      // Finance sees the day but does not change it: no status or move buttons.
      canWrite={can(session, "bookings.write")}
      totals={totals}
    />
  );
}

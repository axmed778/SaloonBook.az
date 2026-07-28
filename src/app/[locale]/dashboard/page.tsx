import { getTranslations, getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  bakuToday,
  bakuDayBoundsUtc,
  bakuMinutesOfDay,
  minutesToHHMM,
  formatBakuDate,
} from "@/lib/time";
import { azn } from "./_components/calendar-shared";
import { TodayView, type TodayAppointment } from "./_components/today-view";

export const dynamic = "force-dynamic";

// Phone-first landing: today's appointments as a chronological, thumb-friendly
// list ("Bu gün"). The full day/week grid moved to /dashboard/calendar.
export default async function DashboardTodayPage() {
  const session = (await getSession())!;
  const locale = await getLocale();
  const t = await getTranslations("Dashboard");

  // Platform admins manage accounts, not a salon.
  if (session.isAdmin) redirect({ href: "/dashboard/admin", locale });
  if (!session.salonId) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold text-foreground">{t("noSalonTitle")}</h1>
        <p className="mt-2 max-w-sm text-sm text-faint-foreground">{t("noSalonBody")}</p>
      </div>
    );
  }

  const salonId = session.salonId;
  const today = bakuToday();
  const { startUtc, endUtc } = bakuDayBoundsUtc(today);
  const now = Date.now();

  // Salon name for the WhatsApp message templates on each row.
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true },
  });

  // Today's bookings, chronological. CANCELLED are excluded (same as the calendar).
  const appts = await prisma.appointment.findMany({
    where: {
      salonId,
      status: { not: "CANCELLED" },
      startsAt: { gte: startUtc, lt: endUtc },
    },
    orderBy: { startsAt: "asc" },
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      priceMinor: true,
      attendeeName: true,
      service: { select: { name: true } },
      employee: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
    },
  });

  const items: TodayAppointment[] = appts.map((a) => ({
    id: a.id,
    time: minutesToHHMM(bakuMinutesOfDay(a.startsAt)),
    status: a.status as TodayAppointment["status"],
    // A past-but-still-CONFIRMED booking needs closing (complete / no-show).
    overdue: a.status === "CONFIRMED" && a.endsAt.getTime() < now,
    service: a.service.name,
    employee: a.employee.name,
    // Who the booking is for; the phone stays the contact's (for WhatsApp).
    clientName: a.attendeeName ?? a.customer.name,
    clientPhone: a.customer.phone,
    priceLabel: `${azn(a.priceMinor)} ₼`,
  }));

  return (
    <TodayView
      items={items}
      dateLabel={formatBakuDate(today, locale)}
      salonName={salon?.name ?? ""}
    />
  );
}

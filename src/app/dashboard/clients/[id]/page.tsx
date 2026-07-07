import { notFound } from "next/navigation";
import { AppointmentStatus } from "@prisma/client";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuYmd, formatBakuDate, formatBakuDateTime } from "@/lib/time";
import type { CatalogEmployee } from "@/app/dashboard/_components/calendar-shared";
import {
  ClientProfile,
  type AppointmentItem,
  type NoteItem,
  type ProfileData,
} from "./client-profile";

export const dynamic = "force-dynamic";

// Every number on this page is derived from Appointment rows at read time —
// nothing is stored twice (Customer.totalVisits/lastVisitAt are legacy dead
// fields). "Visits" = past CONFIRMED/COMPLETED, same definition as the list.

const ACTIVE_WINDOW_DAYS = 90;
const HISTORY_LIMIT = 200;

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = (await getSession())!;
  if (session.isAdmin || !session.salonId) notFound();
  const salonId = session.salonId;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const now = new Date();
  const visitsWhere = {
    salonId,
    customerId: id,
    status: { in: [AppointmentStatus.CONFIRMED, AppointmentStatus.COMPLETED] },
    startsAt: { lte: now },
  };

  const [
    customer,
    statusGroups,
    visitsAgg,
    upcomingCount,
    totalAppointments,
    history,
    favEmployeeGroups,
    favServiceGroups,
    notes,
    salon,
    employees,
  ] = await Promise.all([
    prisma.customer.findFirst({
      where: { id, salonId },
      select: { id: true, name: true, phone: true, createdAt: true },
    }),
    // All-time counts per status (completed / cancelled / no-show stats).
    prisma.appointment.groupBy({
      by: ["status"],
      where: { salonId, customerId: id },
      _count: { _all: true },
    }),
    // The "visits" set: kept past appointments → count, spend, first/last.
    prisma.appointment.aggregate({
      where: visitsWhere,
      _count: { _all: true },
      _sum: { priceMinor: true },
      _min: { startsAt: true },
      _max: { startsAt: true },
    }),
    prisma.appointment.count({
      where: { salonId, customerId: id, status: "CONFIRMED", startsAt: { gt: now } },
    }),
    prisma.appointment.count({ where: { salonId, customerId: id } }),
    prisma.appointment.findMany({
      where: { salonId, customerId: id },
      orderBy: { startsAt: "desc" },
      take: HISTORY_LIMIT,
      select: {
        id: true,
        startsAt: true,
        status: true,
        priceMinor: true,
        source: true,
        createdAt: true,
        service: { select: { name: true } },
        employee: { select: { name: true } },
      },
    }),
    prisma.appointment.groupBy({
      by: ["employeeId"],
      where: visitsWhere,
      _count: { _all: true },
      orderBy: { _count: { employeeId: "desc" } },
      take: 1,
    }),
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: visitsWhere,
      _count: { _all: true },
      orderBy: { _count: { serviceId: "desc" } },
      take: 1,
    }),
    prisma.customerNote.findMany({
      where: { salonId, customerId: id },
      orderBy: { createdAt: "desc" },
      select: { id: true, body: true, createdAt: true },
    }),
    prisma.salon.findUnique({ where: { id: salonId }, select: { name: true } }),
    // Catalog for the prefilled "Yeni görüş" modal — same shape as the calendar.
    prisma.employee.findMany({
      where: { salonId, isActive: true },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        services: {
          where: { service: { isActive: true } },
          select: {
            service: { select: { id: true, name: true, priceMinor: true, durationMin: true } },
          },
        },
      },
    }),
  ]);

  if (!customer) notFound();

  // Favorite employee/service names (single-row lookups).
  const favEmployeeId = favEmployeeGroups[0]?.employeeId ?? null;
  const favServiceId = favServiceGroups[0]?.serviceId ?? null;
  const [favEmployee, favService] = await Promise.all([
    favEmployeeId
      ? prisma.employee.findUnique({ where: { id: favEmployeeId }, select: { name: true } })
      : null,
    favServiceId
      ? prisma.service.findUnique({ where: { id: favServiceId }, select: { name: true } })
      : null,
  ]);

  const counts = new Map(statusGroups.map((g) => [g.status, g._count._all]));
  const visits = visitsAgg._count._all;
  const spentMinor = visitsAgg._sum.priceMinor ?? 0;
  const firstVisit = visitsAgg._min.startsAt;
  const lastVisit = visitsAgg._max.startsAt;

  // Average days between visits, meaningful from the 2nd visit on.
  let frequencyDays: number | null = null;
  if (visits >= 2 && firstVisit && lastVisit && lastVisit > firstVisit) {
    frequencyDays = Math.max(
      1,
      Math.round((lastVisit.getTime() - firstVisit.getTime()) / 86_400_000 / (visits - 1)),
    );
  }

  // Last activity = the most recent thing that happened around this customer:
  // a kept visit or a booking being created (covers upcoming appointments).
  const latestCreated = history[0]
    ? history.reduce((m, h) => (h.createdAt > m ? h.createdAt : m), history[0].createdAt)
    : null;
  const lastActivity =
    [lastVisit, latestCreated]
      .filter((d): d is Date => d !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

  const active =
    (lastVisit !== null && lastVisit.getTime() >= Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000) ||
    upcomingCount > 0;

  const data: ProfileData = {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    createdLabel: formatBakuDate(bakuYmd(customer.createdAt)),
    active,
    stats: {
      visits,
      spentMinor,
      avgTicketMinor: visits > 0 ? Math.round(spentMinor / visits) : 0,
      completed: counts.get("COMPLETED") ?? 0,
      cancelled: counts.get("CANCELLED") ?? 0,
      noShow: counts.get("NO_SHOW") ?? 0,
      upcoming: upcomingCount,
      firstVisitLabel: firstVisit ? formatBakuDate(bakuYmd(firstVisit)) : null,
      lastVisitLabel: lastVisit ? formatBakuDate(bakuYmd(lastVisit)) : null,
      favEmployee: favEmployee?.name ?? null,
      favService: favService?.name ?? null,
      frequencyDays,
      lastActivityLabel: lastActivity ? formatBakuDate(bakuYmd(lastActivity)) : null,
    },
    totalAppointments,
    historyTruncated: totalAppointments > HISTORY_LIMIT,
    branchName: salon?.name ?? "",
  };

  const nowMs = now.getTime();
  const toItem = (h: (typeof history)[number]): AppointmentItem => ({
    id: h.id,
    whenLabel: formatBakuDateTime(h.startsAt),
    service: h.service.name,
    employee: h.employee.name,
    priceMinor: h.priceMinor,
    status: h.status,
    source: h.source,
    createdLabel: formatBakuDateTime(h.createdAt),
  });
  const upcoming: AppointmentItem[] = history
    .filter((h) => h.startsAt.getTime() > nowMs && h.status === "CONFIRMED")
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
    .map(toItem);
  const past: AppointmentItem[] = history
    .filter((h) => !(h.startsAt.getTime() > nowMs && h.status === "CONFIRMED"))
    .map(toItem);

  const noteItems: NoteItem[] = notes.map((n) => ({
    id: n.id,
    body: n.body,
    createdLabel: formatBakuDateTime(n.createdAt),
  }));

  const catalog: CatalogEmployee[] = employees.map((e) => ({
    id: e.id,
    name: e.name,
    services: e.services.map((s) => s.service),
  }));

  return (
    <ClientProfile
      data={data}
      upcoming={upcoming}
      past={past}
      notes={noteItems}
      catalog={catalog}
      today={bakuToday()}
    />
  );
}

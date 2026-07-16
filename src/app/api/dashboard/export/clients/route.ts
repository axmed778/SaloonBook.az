import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { featuresFor } from "@/lib/plans";
import { effectivePlan } from "@/lib/subscription";
import { localeFromCookie } from "@/i18n/request-locale";
import { toCsv } from "@/lib/csv";
import { bakuToday, bakuYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

// PRO data export: the salon's customer base (CRM) as a spreadsheet-ready CSV.
// A full snapshot — no date range — mirroring the /dashboard/clients list
// (visits/spent/last-visit derived from kept appointments, favorite master,
// active flag). Auth + plan enforced here (this route lives outside the
// [locale]/dashboard tree, so the layout guard never runs for it).

// A customer is "active" if they visited within this window or have an upcoming
// confirmed booking — same rule as the clients page.
const ACTIVE_WINDOW_DAYS = 90;

type ListRow = {
  id: string;
  name: string;
  phone: string;
  visits: number;
  spentMinor: number;
  lastVisit: Date | null;
  upcoming: number;
  createdAt: Date;
};

export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (session.isAdmin || !session.salonId) {
    return new Response("Forbidden", { status: 403 });
  }
  const salonId = session.salonId;

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { account: { select: { subscription: true } } },
  });
  if (!featuresFor(effectivePlan(salon?.account.subscription ?? null)).exports) {
    return new Response("Data export requires the Pro plan.", { status: 403 });
  }

  // Visits/spent/last-visit = past appointments the customer actually kept
  // (CONFIRMED or COMPLETED, startsAt <= now); upcoming = future CONFIRMED.
  // Same aggregation as the CRM list, minus its pagination/search.
  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT
      c.id,
      c.name,
      c.phone,
      COALESCE(a.visits, 0)::int        AS visits,
      COALESCE(a."spentMinor", 0)::int  AS "spentMinor",
      a."lastVisit"                     AS "lastVisit",
      COALESCE(u.upcoming, 0)::int      AS upcoming,
      c."createdAt"                     AS "createdAt"
    FROM "Customer" c
    LEFT JOIN (
      SELECT "customerId",
             COUNT(*)          AS visits,
             SUM("priceMinor") AS "spentMinor",
             MAX("startsAt")   AS "lastVisit"
      FROM "Appointment"
      WHERE "salonId" = ${salonId}
        AND status IN ('CONFIRMED', 'COMPLETED')
        AND "startsAt" <= now()
      GROUP BY "customerId"
    ) a ON a."customerId" = c.id
    LEFT JOIN (
      SELECT "customerId", COUNT(*) AS upcoming
      FROM "Appointment"
      WHERE "salonId" = ${salonId}
        AND status = 'CONFIRMED'
        AND "startsAt" > now()
      GROUP BY "customerId"
    ) u ON u."customerId" = c.id
    WHERE c."salonId" = ${salonId}
    ORDER BY c.name ASC
  `;

  // Favorite master per customer: their most-visited (kept appointments) staff.
  const grouped = rows.length
    ? await prisma.appointment.groupBy({
        by: ["customerId", "employeeId"],
        where: {
          salonId,
          status: { in: ["CONFIRMED", "COMPLETED"] },
          startsAt: { lte: new Date() },
        },
        _count: { _all: true },
      })
    : [];
  const best = new Map<string, { employeeId: string; count: number }>();
  for (const g of grouped) {
    const cur = best.get(g.customerId);
    if (!cur || g._count._all > cur.count) {
      best.set(g.customerId, { employeeId: g.employeeId, count: g._count._all });
    }
  }
  const employeeIds = [...new Set([...best.values()].map((b) => b.employeeId))];
  const employees = employeeIds.length
    ? await prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(employees.map((e) => [e.id, e.name]));

  const t = await getTranslations({
    locale: await localeFromCookie(),
    namespace: "Export.clientsCsv",
  });

  const headers = [
    t("headers.name"),
    t("headers.phone"),
    t("headers.visits"),
    t("headers.spent"),
    t("headers.lastVisit"),
    t("headers.upcoming"),
    t("headers.favorite"),
    t("headers.status"),
    t("headers.registered"),
  ];

  const activeCutoff = Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000;
  const csvRows = rows.map((r) => {
    const fav = best.get(r.id);
    const active =
      (r.lastVisit !== null && r.lastVisit.getTime() >= activeCutoff) || r.upcoming > 0;
    return [
      r.name,
      r.phone,
      r.visits,
      (r.spentMinor / 100).toFixed(2),
      r.lastVisit ? bakuYmd(r.lastVisit) : "",
      r.upcoming,
      fav ? (nameById.get(fav.employeeId) ?? "") : "",
      active ? t("status.active") : t("status.inactive"),
      bakuYmd(r.createdAt),
    ];
  });

  const csv = toCsv(headers, csvRows);
  const filename = `salonbook-clients-${bakuToday()}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

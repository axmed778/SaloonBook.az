import { Prisma } from "@prisma/client";
import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuYmd, formatBakuDate } from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { ClientsTable, type ClientRow, type SortKey } from "./clients-table";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

// A customer counts as "active" if they visited within this window or have an
// upcoming confirmed booking.
const ACTIVE_WINDOW_DAYS = 90;

// "Visits" throughout the CRM = past appointments the customer actually kept:
// COMPLETED, plus past CONFIRMED that the salon never got around to marking.
// CANCELLED and NO_SHOW never count. Spent/last-visit derive from the same set,
// so the numbers always agree with each other (and are never stored).

const SORTS: Record<SortKey, { asc: Prisma.Sql; desc: Prisma.Sql }> = {
  name: { asc: Prisma.sql`c.name ASC`, desc: Prisma.sql`c.name DESC` },
  last: {
    asc: Prisma.sql`a."lastVisit" ASC NULLS FIRST`,
    desc: Prisma.sql`a."lastVisit" DESC NULLS LAST`,
  },
  visits: {
    asc: Prisma.sql`COALESCE(a.visits, 0) ASC`,
    desc: Prisma.sql`COALESCE(a.visits, 0) DESC`,
  },
  spent: {
    asc: Prisma.sql`COALESCE(a."spentMinor", 0) ASC`,
    desc: Prisma.sql`COALESCE(a."spentMinor", 0) DESC`,
  },
};

type ListRow = {
  id: string;
  name: string;
  phone: string;
  visits: number;
  spentMinor: number;
  lastVisit: Date | null;
  upcoming: number;
  total: number;
};

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const session = (await getSession())!;
  const df = intlLocale(await getLocale());

  if (session.isAdmin || !session.salonId) {
    const t = await getTranslations("Clients");
    const td = await getTranslations("Dashboard");
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold text-foreground">
          {session.isAdmin ? t("adminTitle") : td("noSalonTitle")}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-faint-foreground">
          {session.isAdmin ? t("adminBody") : td("noSalonBody")}
        </p>
      </div>
    );
  }
  const salonId = session.salonId;

  const params = await searchParams;
  const q = (params.q ?? "").trim().slice(0, 80);
  const sort: SortKey = (["name", "last", "visits", "spent"] as const).includes(
    params.sort as SortKey,
  )
    ? (params.sort as SortKey)
    : "last";
  const dir = params.dir === "asc" ? "asc" : "desc";
  const page = Math.max(1, Math.min(10_000, Number(params.page) || 1));

  // Search: name is a case-insensitive contains; if the query contains 2+
  // digits it also matches the phone (stored dense: +994XXXXXXXXX).
  const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const qDigits = q.replace(/\D/g, "");
  const searchSql =
    q === ""
      ? Prisma.empty
      : qDigits.length >= 2
        ? Prisma.sql`AND (c.name ILIKE ${like} OR c.phone LIKE ${`%${qDigits}%`})`
        : Prisma.sql`AND c.name ILIKE ${like}`;

  const rows = await prisma.$queryRaw<ListRow[]>`
    SELECT
      c.id,
      c.name,
      c.phone,
      COALESCE(a.visits, 0)::int        AS visits,
      COALESCE(a."spentMinor", 0)::int  AS "spentMinor",
      a."lastVisit"                     AS "lastVisit",
      COALESCE(u.upcoming, 0)::int      AS upcoming,
      (COUNT(*) OVER ())::int           AS total
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
    ${searchSql}
    ORDER BY ${SORTS[sort][dir]}, c.name ASC
    LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}
  `;

  const total = rows[0]?.total ?? 0;

  // Favorite employee for just this page's customers: their most-visited master.
  const ids = rows.map((r) => r.id);
  let favByCustomer = new Map<string, string>();
  if (ids.length > 0) {
    const grouped = await prisma.appointment.groupBy({
      by: ["customerId", "employeeId"],
      where: {
        salonId,
        customerId: { in: ids },
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { lte: new Date() },
      },
      _count: { _all: true },
    });
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
    favByCustomer = new Map(
      [...best.entries()].map(([customerId, b]) => [
        customerId,
        nameById.get(b.employeeId) ?? "—",
      ]),
    );
  }

  const activeCutoff = Date.now() - ACTIVE_WINDOW_DAYS * 86_400_000;
  const clientRows: ClientRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    phone: r.phone,
    visits: r.visits,
    spentMinor: r.spentMinor,
    lastVisitLabel: r.lastVisit ? formatBakuDate(bakuYmd(r.lastVisit), df) : null,
    favEmployee: favByCustomer.get(r.id) ?? null,
    active: (r.lastVisit !== null && r.lastVisit.getTime() >= activeCutoff) || r.upcoming > 0,
  }));

  // Distinguish "salon has no customers yet" from "search found nothing".
  const salonIsEmpty =
    total === 0 && q === "" ? (await prisma.customer.count({ where: { salonId } })) === 0 : false;

  return (
    <ClientsTable
      rows={clientRows}
      total={total}
      page={page}
      pageSize={PAGE_SIZE}
      q={q}
      sort={sort}
      dir={dir}
      salonIsEmpty={salonIsEmpty}
    />
  );
}

import { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { withTenantScope } from "@/lib/tenant";
import { featuresFor } from "@/lib/plans";
import { effectivePlan } from "@/lib/subscription";
import { localeFromCookie } from "@/i18n/request-locale";
import {
  csvStreamResponse,
  EXPORT_BATCH_SIZE,
  MAX_EXPORT_ROWS,
} from "../_lib/csv-stream";
import { bakuToday, bakuYmd } from "@/lib/time";

export const dynamic = "force-dynamic";

// PRO data export: the salon's customer base (CRM) as a spreadsheet-ready CSV.
// A full snapshot — no date range — mirroring the /dashboard/clients list
// (visits/spent/last-visit derived from kept appointments, favorite master,
// active flag). Auth + plan enforced here (this route lives outside the
// [locale]/dashboard tree, so the layout guard never runs for it).
//
// Streamed in batches: the snapshot has no upper bound, so materializing the
// whole customer base inside one transaction pinned a pooled connection for as
// long as the download took. See ../_lib/csv-stream.ts.

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

  const locale = await localeFromCookie();
  const [t, tLimits] = await Promise.all([
    getTranslations({ locale, namespace: "Export.clientsCsv" }),
    getTranslations({ locale, namespace: "Export.limits" }),
  ]);

  // Everything touching tenant tables runs inside the RLS scope: on the
  // restricted role Postgres itself refuses to return another salon's rows, so
  // the salonId predicates below are belt-and-braces rather than the only
  // guard. This route hands back a salon's entire customer base — the largest
  // bulk-PII surface in the product — which is why it is among the first paths
  // moved onto prismaRls.
  //
  // First a short transaction for the two bounded lookups: how big is this
  // export, and the staff name lookup the favorite-master column needs (one row
  // per employee, so it stays small however many customers there are).
  const { total, nameById } = await withTenantScope(salonId, async (tx) => {
    const total = await tx.customer.count({ where: { salonId } });
    const employees = await tx.employee.findMany({
      where: { salonId },
      select: { id: true, name: true },
    });
    return { total, nameById: new Map(employees.map((e) => [e.id, e.name])) };
  });

  // Refuse up front rather than mid-download: once the CSV headers are on the
  // wire there is no way to turn the response back into an error.
  if (total > MAX_EXPORT_ROWS) {
    return new Response(tLimits("clients", { count: total, max: MAX_EXPORT_ROWS }), {
      status: 413,
    });
  }

  // Pinned once, not per batch: "kept appointments so far" and the active
  // window must mean the same instant on the first row and the last, or a
  // booking that starts mid-export would count for some customers and not
  // others.
  const now = new Date();
  const activeCutoff = now.getTime() - ACTIVE_WINDOW_DAYS * 86_400_000;

  // Keyset pagination on (name, id). Name alone is not unique — two customers
  // with the same name would have no stable order between batches, so a row
  // could be skipped or duplicated at a boundary.
  let cursor: { name: string; id: string } | null = null;

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

  const filename = `salonbook-clients-${bakuToday()}.csv`;

  return csvStreamResponse({
    filename,
    headers,
    nextBatch: async () => {
      const after = cursor;
      const { rows, best } = await withTenantScope(salonId, async (tx) => {
        // Visits/spent/last-visit = past appointments the customer actually kept
        // (CONFIRMED or COMPLETED, startsAt <= now); upcoming = future CONFIRMED.
        // Same aggregation as the CRM list, minus its pagination/search.
        const keyset = after
          ? Prisma.sql`AND (c.name, c.id) > (${after.name}::text, ${after.id}::text)`
          : Prisma.empty;

        // The `page` CTE picks the batch FIRST, and both aggregates are then
        // restricted to it. Aggregating the salon's whole Appointment table on
        // every batch — which is what the un-paginated version effectively did
        // once — would make the export quadratic in its own length.
        const rows = await tx.$queryRaw<ListRow[]>`
          WITH page AS (
            SELECT c.id, c.name, c.phone, c."createdAt"
            FROM "Customer" c
            WHERE c."salonId" = ${salonId}
            ${keyset}
            ORDER BY c.name ASC, c.id ASC
            LIMIT ${EXPORT_BATCH_SIZE}
          )
          SELECT
            p.id,
            p.name,
            p.phone,
            COALESCE(a.visits, 0)::int        AS visits,
            COALESCE(a."spentMinor", 0)::int  AS "spentMinor",
            a."lastVisit"                     AS "lastVisit",
            COALESCE(u.upcoming, 0)::int      AS upcoming,
            p."createdAt"                     AS "createdAt"
          FROM page p
          LEFT JOIN (
            SELECT "customerId",
                   COUNT(*)          AS visits,
                   SUM("priceMinor") AS "spentMinor",
                   MAX("startsAt")   AS "lastVisit"
            FROM "Appointment"
            WHERE "salonId" = ${salonId}
              AND status IN ('CONFIRMED', 'COMPLETED')
              AND "startsAt" <= ${now}::timestamptz
              AND "customerId" IN (SELECT id FROM page)
            GROUP BY "customerId"
          ) a ON a."customerId" = p.id
          LEFT JOIN (
            SELECT "customerId", COUNT(*) AS upcoming
            FROM "Appointment"
            WHERE "salonId" = ${salonId}
              AND status = 'CONFIRMED'
              AND "startsAt" > ${now}::timestamptz
              AND "customerId" IN (SELECT id FROM page)
            GROUP BY "customerId"
          ) u ON u."customerId" = p.id
          ORDER BY p.name ASC, p.id ASC
        `;

        // Favorite master per customer: their most-visited (kept appointments)
        // staff. Scoped to THIS batch's customers so the group-by result cannot
        // outgrow the batch.
        const grouped = rows.length
          ? await tx.appointment.groupBy({
              by: ["customerId", "employeeId"],
              where: {
                salonId,
                customerId: { in: rows.map((r) => r.id) },
                status: { in: ["CONFIRMED", "COMPLETED"] },
                startsAt: { lte: now },
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
        return { rows, best };
      });

      if (rows.length > 0) {
        const last = rows[rows.length - 1];
        cursor = { name: last.name, id: last.id };
      }

      return rows.map((r) => {
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
    },
  });
}

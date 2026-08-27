import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
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
import {
  bakuToday,
  bakuYmd,
  bakuDayBoundsUtc,
  bakuMinutesOfDay,
  minutesToHHMM,
} from "@/lib/time";

export const dynamic = "force-dynamic";

// PRO data export: the salon's appointments as a spreadsheet-ready CSV.
// Auth + plan are enforced here (this route lives outside the [locale]/dashboard
// tree, so the layout's session guard never runs for it).

type Range = "this-month" | "last-month" | "this-year" | "all";
const RANGES: Range[] = ["this-month", "last-month", "this-year", "all"];

/** Shift a Baku "YYYY-MM" month key by whole months. */
function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** UTC [gte, lt) bounds for a preset range, in Baku calendar terms. */
function rangeWindow(range: Range): { gte?: Date; lt?: Date } {
  const ym = bakuToday().slice(0, 7); // current Baku month, "YYYY-MM"
  const year = ym.slice(0, 4);
  switch (range) {
    case "this-month":
      return {
        gte: bakuDayBoundsUtc(`${ym}-01`).startUtc,
        lt: bakuDayBoundsUtc(`${shiftYm(ym, 1)}-01`).startUtc,
      };
    case "last-month":
      return {
        gte: bakuDayBoundsUtc(`${shiftYm(ym, -1)}-01`).startUtc,
        lt: bakuDayBoundsUtc(`${ym}-01`).startUtc,
      };
    case "this-year":
      return {
        gte: bakuDayBoundsUtc(`${year}-01-01`).startUtc,
        lt: bakuDayBoundsUtc(`${Number(year) + 1}-01-01`).startUtc,
      };
    case "all":
      return {};
  }
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (session.isAdmin || !session.salonId) {
    return new Response("Forbidden", { status: 403 });
  }
  const salonId = session.salonId;

  // Plan gate — mirrors the analytics UI, enforced independently here.
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { account: { select: { subscription: true } } },
  });
  if (!featuresFor(effectivePlan(salon?.account.subscription ?? null)).exports) {
    return new Response("Data export requires the Pro plan.", { status: 403 });
  }

  const rangeParam = req.nextUrl.searchParams.get("range");
  const range: Range = RANGES.includes(rangeParam as Range)
    ? (rangeParam as Range)
    : "this-month";
  const { gte, lt } = rangeWindow(range);

  const where: Prisma.AppointmentWhereInput = { salonId };
  if (gte || lt) where.startsAt = { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) };

  const locale = await localeFromCookie();
  const [t, tLimits] = await Promise.all([
    getTranslations({ locale, namespace: "Export.csv" }),
    getTranslations({ locale, namespace: "Export.limits" }),
  ]);

  // Size the export BEFORE writing a byte. range=all has no upper bound, and a
  // count is one indexed aggregate — cheap next to discovering the problem
  // halfway through a multi-megabyte download that cannot be turned back into
  // an error response once the headers are out.
  const total = await withTenantScope(salonId, (tx) => tx.appointment.count({ where }));
  if (total > MAX_EXPORT_ROWS) {
    return new Response(tLimits("appointments", { count: total, max: MAX_EXPORT_ROWS }), {
      status: 413,
    });
  }

  const headers = [
    t("headers.date"),
    t("headers.start"),
    t("headers.end"),
    t("headers.status"),
    t("headers.source"),
    t("headers.customer"),
    t("headers.phone"),
    t("headers.service"),
    t("headers.employee"),
    t("headers.price"),
    t("headers.notes"),
    t("headers.created"),
  ];

  // Keyset pagination on (startsAt, id). `id` is in the ordering as well as the
  // cursor because startsAt is not unique — two bookings that start at the same
  // minute would otherwise have no stable order between batches, and a row could
  // be skipped or repeated at a batch boundary.
  let cursorId: string | null = null;

  const filename = `salonbook-appointments-${range}-${bakuToday()}.csv`;

  return csvStreamResponse({
    filename,
    headers,
    nextBatch: async () => {
      // One SHORT transaction per batch. Inside the RLS scope: on the restricted
      // role Postgres refuses to return another salon's rows, so `where.salonId`
      // is belt-and-braces rather than the only guard. This route dumps a
      // salon's appointment history — customer names and phones included.
      const appointments = await withTenantScope(salonId, (tx) =>
        tx.appointment.findMany({
          where,
          orderBy: [{ startsAt: "asc" }, { id: "asc" }],
          take: EXPORT_BATCH_SIZE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
          select: {
            id: true,
            startsAt: true,
            endsAt: true,
            status: true,
            source: true,
            priceMinor: true,
            notes: true,
            createdAt: true,
            attendeeName: true,
            customer: { select: { name: true, phone: true } },
            service: { select: { name: true } },
            employee: { select: { name: true } },
          },
        }),
      );

      if (appointments.length > 0) {
        cursorId = appointments[appointments.length - 1].id;
      }

      return appointments.map((a) => [
        bakuYmd(a.startsAt),
        minutesToHHMM(bakuMinutesOfDay(a.startsAt)),
        minutesToHHMM(bakuMinutesOfDay(a.endsAt)),
        t(`status.${a.status}`),
        t(`source.${a.source}`),
        a.attendeeName ?? a.customer.name,
        a.customer.phone,
        a.service.name,
        a.employee.name,
        (a.priceMinor / 100).toFixed(2),
        a.notes ?? "",
        bakuYmd(a.createdAt),
      ]);
    },
  });
}

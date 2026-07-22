import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import {
  BAKU_TZ,
  bakuToday,
  bakuYmd,
  bakuDayBoundsUtc,
  formatBakuDate,
} from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { PLAN_LIMITS, featuresFor } from "@/lib/plans";
import { effectivePlan } from "@/lib/subscription";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { HeroValue } from "./_components/HeroValue";
import { ExportCard } from "./_components/ExportCard";
import { TrialNudge } from "./_components/TrialNudge";
import { StatCard, type Delta } from "./_components/StatCard";
import { OnlineShareCard } from "./_components/OnlineShareCard";
import { TopServices, type TopServiceRow } from "./_components/TopServices";
import { CustomerSourceCard } from "./_components/CustomerSourceCard";
import { RankedBars, type RankRow } from "./_components/RankedBars";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  // The layout already guarantees a session (redirects otherwise).
  const session = (await getSession())!;
  const t = await getTranslations("Analytics");
  const locale = await getLocale();
  const df = intlLocale(locale);

  // Platform admins don't own a salon; analytics is a per-salon surface.
  if (session.isAdmin || !session.salonId) {
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

  // --- Baku month window, computed once and reused by every query. ---
  const ym = bakuToday().slice(0, 7);
  const monthStartUtc = bakuDayBoundsUtc(`${ym}-01`).startUtc;
  const [Y, M] = ym.split("-").map(Number);
  const nextYm = M === 12 ? `${Y + 1}-01` : `${Y}-${String(M + 1).padStart(2, "0")}`;
  const monthEndUtc = bakuDayBoundsUtc(`${nextYm}-01`).startUtc;
  const prevYm = M === 1 ? `${Y - 1}-12` : `${Y}-${String(M - 1).padStart(2, "0")}`;
  const prevMonthStartUtc = bakuDayBoundsUtc(`${prevYm}-01`).startUtc;
  const now = new Date();

  // Same elapsed slice of last month, so the MoM delta compares month-to-date
  // against month-to-date — not a partial current month against a full prior
  // one (which showed a spurious red "−N%" for most of every month). Clamped to
  // the previous month's end for months longer than the previous one.
  const prevPartialEndUtc = new Date(
    Math.min(
      prevMonthStartUtc.getTime() + (now.getTime() - monthStartUtc.getTime()),
      monthStartUtc.getTime(),
    ),
  );

  const monthLabel = new Intl.DateTimeFormat(df, {
    timeZone: BAKU_TZ,
    month: "long",
    year: "numeric",
  })
    .format(new Date())
    .toLocaleUpperCase(df);

  // Fire every independent query concurrently on the server.
  const [
    heroAgg,
    revCur,
    revPrev,
    totalCount,
    expectedAgg,
    noShowCount,
    returnThisMonth,
    waDelivered,
    waTotal,
    topRows,
    salonRow,
    everOnlineGroup,
    firstSourceRows,
    topCustomerGroup,
    topMasterGroup,
  ] = await Promise.all([
    // HERO — self-service (PUBLIC) bookings this month; excludes CANCELLED/NO_SHOW.
    prisma.appointment.aggregate({
      where: {
        salonId,
        source: "PUBLIC",
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
      _count: { _all: true },
      _sum: { priceMinor: true },
    }),
    // Realized revenue this month (COMPLETED only). _count doubles as the
    // no-show-rate denominator (completed + no-show = appointments that reached
    // their time).
    prisma.appointment.aggregate({
      where: {
        salonId,
        status: "COMPLETED",
        startsAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
      _sum: { priceMinor: true },
      _count: { _all: true },
    }),
    // Realized revenue over the SAME elapsed slice of last month (month-to-date),
    // so the MoM delta is like-for-like.
    prisma.appointment.aggregate({
      where: {
        salonId,
        status: "COMPLETED",
        startsAt: { gte: prevMonthStartUtc, lt: prevPartialEndUtc },
      },
      _sum: { priceMinor: true },
    }),
    // Total booking volume this month (CONFIRMED + COMPLETED, all sources).
    prisma.appointment.count({
      where: {
        salonId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
    }),
    // Expected pipeline: future CONFIRMED for the rest of the month.
    prisma.appointment.aggregate({
      where: {
        salonId,
        status: "CONFIRMED",
        startsAt: { gte: now, lt: monthEndUtc },
      },
      _count: { _all: true },
      _sum: { priceMinor: true },
    }),
    // No-shows this month (shown honestly, separately).
    prisma.appointment.count({
      where: {
        salonId,
        status: "NO_SHOW",
        startsAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
    }),
    // Distinct customers with an appointment this month (returning-rate numerator base).
    prisma.appointment.groupBy({
      by: ["customerId"],
      where: {
        salonId,
        status: { not: "CANCELLED" },
        startsAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
    }),
    // Delivered WhatsApp reminders this month.
    prisma.notification.count({
      where: {
        salonId,
        status: { in: ["SENT", "DELIVERED", "READ"] },
        createdAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
    }),
    // All-time notification count — distinguishes "worker not live yet" from a quiet month.
    prisma.notification.count({ where: { salonId } }),
    // Top revenue services this month.
    prisma.appointment.groupBy({
      by: ["serviceId"],
      where: {
        salonId,
        status: { in: ["CONFIRMED", "COMPLETED"] },
        startsAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
      _count: { _all: true },
      _sum: { priceMinor: true },
      orderBy: { _sum: { priceMinor: "desc" } },
      take: 5,
    }),
    // Subscription (may be null) + slug for the empty-state share link.
    prisma.salon.findUnique({
      where: { id: salonId },
      select: { slug: true, account: { select: { subscription: true } } },
    }),
    // All-time: distinct customers who have EVER booked online (source=PUBLIC),
    // i.e. who use the self-service online booking at all.
    prisma.appointment.groupBy({
      by: ["customerId"],
      where: { salonId, source: "PUBLIC" },
    }),
    // All-time: each customer's FIRST-ever booking source (acquisition channel).
    // DISTINCT ON keeps one row per customer, the earliest by createdAt.
    prisma.$queryRaw<{ source: string }[]>`
      SELECT DISTINCT ON ("customerId") "source"
      FROM "Appointment"
      WHERE "salonId" = ${salonId}
      ORDER BY "customerId", "createdAt" ASC
    `,
    // All-time top customers by appointment count. Customer.totalVisits is a
    // dead counter (never written), so aggregate from appointments instead.
    prisma.appointment.groupBy({
      by: ["customerId"],
      where: { salonId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      _count: { _all: true },
      orderBy: { _count: { customerId: "desc" } },
      take: 5,
    }),
    // All-time most-booked masters.
    prisma.appointment.groupBy({
      by: ["employeeId"],
      where: { salonId, status: { in: ["CONFIRMED", "COMPLETED"] } },
      _count: { _all: true },
      orderBy: { _count: { employeeId: "desc" } },
      take: 5,
    }),
  ]);

  // Dependent follow-ups: returning customers need the this-month id set; top
  // service names need the grouped service ids.
  const thisMonthIds = returnThisMonth.map((r) => r.customerId);
  const [prior, serviceNames, topCustomerNames, topMasterNames] = await Promise.all([
    thisMonthIds.length
      ? prisma.appointment.groupBy({
          by: ["customerId"],
          where: {
            salonId,
            status: { not: "CANCELLED" },
            startsAt: { lt: monthStartUtc },
            customerId: { in: thisMonthIds },
          },
        })
      : Promise.resolve([] as { customerId: string }[]),
    topRows.length
      ? prisma.service.findMany({
          where: { id: { in: topRows.map((r) => r.serviceId) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    topCustomerGroup.length
      ? prisma.customer.findMany({
          where: { id: { in: topCustomerGroup.map((r) => r.customerId) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    topMasterGroup.length
      ? prisma.employee.findMany({
          where: { id: { in: topMasterGroup.map((r) => r.employeeId) } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
  ]);

  // --- Hero ---
  const heroCount = heroAgg._count._all;
  const heroValueMinor = heroAgg._sum.priceMinor ?? 0;
  const slug = salonRow?.slug ?? null;
  const bookingHref = slug ? `/${slug}` : "/dashboard/settings";

  // --- Trial nudge / subscription ---
  const sub = salonRow?.account?.subscription ?? null;
  let daysLeft: number | null = null;
  if (sub?.trialEndsAt) {
    const a = bakuToday();
    const b = bakuYmd(sub.trialEndsAt);
    const [ay, am, ad] = a.split("-").map(Number);
    const [by, bm, bd] = b.split("-").map(Number);
    daysLeft = Math.max(
      0,
      Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000),
    );
  }
  const canExport = featuresFor(effectivePlan(sub)).exports;
  const planPriceMinor = PLAN_LIMITS[sub?.plan ?? "BASIC"].priceMinor;
  // Internal BASIC tier is marketed as "Salon"; START/PRO keep their names
  // (see MARKETING_PLANS).
  const planLabel = sub?.plan === "PRO" ? "Pro" : sub?.plan === "START" ? "Start" : "Salon";
  const periodEndLabel = sub?.currentPeriodEnd
    ? formatBakuDate(bakuYmd(sub.currentPeriodEnd), df)
    : null;

  // --- Realized revenue + MoM delta ---
  const revCurMinor = revCur._sum.priceMinor ?? 0;
  const revPrevMinor = revPrev._sum.priceMinor ?? 0;
  let revDelta: Delta | null = null;
  if (revPrevMinor > 0) {
    const pct = Math.round(((revCurMinor - revPrevMinor) / revPrevMinor) * 100);
    revDelta =
      pct >= 0
        ? { text: `+${pct}%`, tone: "emerald" }
        : { text: `−${Math.abs(pct)}%`, tone: "rose" };
  } else if (revCurMinor > 0) {
    revDelta = { text: t("cards.new"), tone: "neutral" };
  }

  // --- Online share ---
  const share = totalCount > 0 ? Math.round((heroCount / totalCount) * 100) : null;

  // --- Expected pipeline ---
  const expectedMinor = expectedAgg._sum.priceMinor ?? 0;
  const expectedCount = expectedAgg._count._all;

  // --- Returning customers (Appointment aggregation only) ---
  const returning = prior.length;
  const rate = thisMonthIds.length > 0 ? Math.round((returning / thisMonthIds.length) * 100) : 0;

  // --- No-show rate: share of appointments that reached their time (completed
  // or no-show) where the client didn't show. This is the number that sells the
  // WhatsApp-reminder feature ("X% no-shows → reminders cut it"). ---
  const completedCount = revCur._count._all;
  const noShowDenom = completedCount + noShowCount;
  const noShowRate = noShowDenom > 0 ? Math.round((noShowCount / noShowDenom) * 100) : null;

  // --- WhatsApp ---
  const waComingSoon = waTotal === 0;

  // --- Top services ---
  const nameMap = new Map(serviceNames.map((s) => [s.id, s.name]));
  const maxSum = topRows[0]?._sum.priceMinor ?? 0;
  const topServiceRows: TopServiceRow[] = topRows.map((r) => {
    const revenueMinor = r._sum.priceMinor ?? 0;
    return {
      name: nameMap.get(r.serviceId) ?? t("topServices.serviceFallback"),
      count: r._count._all,
      revenueMinor,
      pct: maxSum > 0 ? Math.round((revenueMinor / maxSum) * 100) : 0,
    };
  });

  // --- Customer online adoption (all-time, whole client base) ---
  const totalCustomers = firstSourceRows.length;
  const everOnlineCustomers = everOnlineGroup.length;
  const acquiredOnlineCustomers = firstSourceRows.filter((r) => r.source === "PUBLIC").length;

  // --- All-time leaderboards ---
  const toRankRows = (
    rows: { id: string; count: number }[],
    names: { id: string; name: string }[],
    fallback: string,
  ): RankRow[] => {
    const nameById = new Map(names.map((n) => [n.id, n.name]));
    const max = rows[0]?.count ?? 0;
    return rows.map((r) => ({
      key: r.id,
      label: nameById.get(r.id) ?? fallback,
      value: t("leaderboards.appointments", { count: r.count }),
      pct: max > 0 ? Math.round((r.count / max) * 100) : 0,
    }));
  };
  const topCustomerRank = toRankRows(
    topCustomerGroup.map((r) => ({ id: r.customerId, count: r._count._all })),
    topCustomerNames,
    t("leaderboards.customerFallback"),
  );
  const topMasterRank = toRankRows(
    topMasterGroup.map((r) => ({ id: r.employeeId, count: r._count._all })),
    topMasterNames,
    t("leaderboards.masterFallback"),
  );

  return (
    <div className="mx-auto max-w-4xl space-y-4 px-4 py-6">
      <HeroValue
        monthLabel={monthLabel}
        count={heroCount}
        valueMinor={heroValueMinor}
        bookingHref={bookingHref}
      />

      <TrialNudge
        status={sub?.status ?? null}
        daysLeft={daysLeft}
        planPriceMinor={planPriceMinor}
        planLabel={planLabel}
        periodEndLabel={periodEndLabel}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard
          label={t("cards.revenue")}
          value={`${azn(revCurMinor)} ₼`}
          valueTone="rose"
          delta={revDelta}
        />

        <OnlineShareCard share={share} publicCount={heroCount} totalCount={totalCount} />

        <StatCard
          label={t("cards.expected")}
          value={`${azn(expectedMinor)} ₼`}
          subline={t("cards.expectedSub", { count: expectedCount })}
        />

        <StatCard
          label={t("cards.totalBookings")}
          value={String(totalCount)}
          subline={
            noShowCount > 0
              ? t("cards.noShowSub", { count: noShowCount, rate: noShowRate ?? 0 })
              : null
          }
          sublineTone="amber"
        />

        <StatCard
          label={t("cards.returning")}
          value={String(returning)}
          subline={thisMonthIds.length > 0 ? t("cards.returnRate", { rate }) : t("cards.noCustomers")}
        />

        <StatCard
          label={t("cards.whatsapp")}
          value={waComingSoon ? t("cards.comingSoon") : String(waDelivered)}
          valueTone={waComingSoon ? "muted" : "emerald"}
          subline={
            waComingSoon
              ? noShowRate !== null
                ? t("cards.waHook", { rate: noShowRate })
                : null
              : t("cards.waSent")
          }
        />

        <TopServices rows={topServiceRows} />
      </div>

      <CustomerSourceCard
        total={totalCustomers}
        everOnline={everOnlineCustomers}
        acquiredOnline={acquiredOnlineCustomers}
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <RankedBars
          title={t("leaderboards.topCustomers")}
          rows={topCustomerRank}
          empty={t("leaderboards.empty")}
        />
        <RankedBars
          title={t("leaderboards.topMasters")}
          rows={topMasterRank}
          empty={t("leaderboards.empty")}
        />
      </div>

      <ExportCard canExport={canExport} />
    </div>
  );
}

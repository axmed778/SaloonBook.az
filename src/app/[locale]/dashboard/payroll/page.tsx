import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuDayBoundsUtc } from "@/lib/time";
import { featuresFor } from "@/lib/plans";
import { effectivePlan } from "@/lib/subscription";
import { PayrollManager, type PayrollRow, type PayoutItem } from "./payroll-manager";

export const dynamic = "force-dynamic";

// PRO payroll: per-employee earnings for a Baku month (fixed salary +
// commission % of COMPLETED appointment revenue) and the payouts recorded
// against them. Plan-gated here for the UI and again in every server action.

function shiftYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default async function PayrollPage({
  searchParams,
}: {
  searchParams: Promise<{ ay?: string }>;
}) {
  const session = (await getSession())!;
  const t = await getTranslations("Payroll");

  if (session.isAdmin || !session.salonId) {
    const td = await getTranslations("Dashboard");
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        <h1 className="text-xl font-semibold text-zinc-100">
          {session.isAdmin ? t("adminTitle") : td("noSalonTitle")}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-zinc-500">
          {session.isAdmin ? t("adminBody") : td("noSalonBody")}
        </p>
      </div>
    );
  }
  const salonId = session.salonId;

  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { account: { select: { subscription: true } } },
  });
  const plan = effectivePlan(salon?.account.subscription ?? null);

  if (!featuresFor(plan).payroll) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <h1 className="text-lg font-semibold text-zinc-100">{t("title")}</h1>
        <div className="mt-4 rounded-xl border border-rose-500/40 bg-rose-500/5 p-6">
          <p className="text-sm font-medium text-zinc-100">
            {t("proOnly")}
          </p>
          <p className="mt-2 text-sm text-zinc-400">
            {t("proBody")}
          </p>
          <Link
            href="/dashboard/billing"
            className="mt-4 inline-flex items-center rounded-lg bg-rose-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-rose-400"
          >
            {t("upgradeToPro")}
          </Link>
        </div>
      </div>
    );
  }

  // Month selection (?ay=YYYY-MM), defaulting to the current Baku month.
  const { ay } = await searchParams;
  const currentYm = bakuToday().slice(0, 7);
  const ym = ay && /^\d{4}-\d{2}$/.test(ay) ? ay : currentYm;
  const monthStartUtc = bakuDayBoundsUtc(`${ym}-01`).startUtc;
  const monthEndUtc = bakuDayBoundsUtc(`${shiftYm(ym, 1)}-01`).startUtc;

  const [employees, completedByEmployee, payouts] = await Promise.all([
    prisma.employee.findMany({
      where: { salonId },
      select: {
        id: true,
        name: true,
        position: true,
        isActive: true,
        baseSalaryMinor: true,
        commissionPct: true,
      },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    }),
    prisma.appointment.groupBy({
      by: ["employeeId"],
      where: {
        salonId,
        status: "COMPLETED",
        startsAt: { gte: monthStartUtc, lt: monthEndUtc },
      },
      _count: { _all: true },
      _sum: { priceMinor: true },
    }),
    prisma.payout.findMany({
      where: { salonId, periodYm: ym },
      select: {
        id: true,
        employeeId: true,
        amountMinor: true,
        note: true,
        paidAt: true,
      },
      orderBy: { paidAt: "asc" },
    }),
  ]);

  const statByEmployee = new Map(
    completedByEmployee.map((r) => [
      r.employeeId,
      { count: r._count._all, revenueMinor: r._sum.priceMinor ?? 0 },
    ]),
  );
  const paidByEmployee = new Map<string, number>();
  for (const p of payouts) {
    paidByEmployee.set(p.employeeId, (paidByEmployee.get(p.employeeId) ?? 0) + p.amountMinor);
  }

  const rows: PayrollRow[] = employees
    .map((e) => {
      const stat = statByEmployee.get(e.id) ?? { count: 0, revenueMinor: 0 };
      const commissionMinor = Math.floor((stat.revenueMinor * e.commissionPct) / 100);
      const earnedMinor = e.baseSalaryMinor + commissionMinor;
      const paidMinor = paidByEmployee.get(e.id) ?? 0;
      return {
        id: e.id,
        name: e.name,
        position: e.position,
        isActive: e.isActive,
        baseSalaryMinor: e.baseSalaryMinor,
        commissionPct: e.commissionPct,
        completedCount: stat.count,
        revenueMinor: stat.revenueMinor,
        commissionMinor,
        earnedMinor,
        paidMinor,
      };
    })
    // Inactive employees stay visible only for months where they still have
    // activity or payouts — old staff don't clutter the current month.
    .filter((r) => r.isActive || r.completedCount > 0 || r.paidMinor > 0);

  const payoutItems: PayoutItem[] = payouts.map((p) => ({
    id: p.id,
    employeeId: p.employeeId,
    amountMinor: p.amountMinor,
    note: p.note,
    paidAtIso: p.paidAt.toISOString(),
  }));

  return (
    <PayrollManager
      ym={ym}
      currentYm={currentYm}
      rows={rows}
      payouts={payoutItems}
    />
  );
}

import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuYmd, formatBakuDate } from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { effectivePlan } from "@/lib/subscription";
import { featuresFor, limitsFor } from "@/lib/plans";
import { AdminAccounts, type AccountRow } from "./admin-accounts";

export const dynamic = "force-dynamic";

// Platform-admin panel: every account with its subscription truth (raw status
// AND the time-aware effective plan), this month's usage, payment history, and
// the manual "mark paid" action. Replaces the scripts/activate-plan.ts workflow
// with a UI (the script still works for emergencies).

export default async function AdminPage() {
  const session = (await getSession())!;
  if (!session.isAdmin) notFound();
  const t = await getTranslations("Admin");
  const df = intlLocale(await getLocale());

  const periodYm = bakuToday().slice(0, 7);
  const [accounts, usage] = await Promise.all([
    prisma.account.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        subscription: {
          select: {
            plan: true,
            status: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
            extraBranches: true,
            payments: {
              orderBy: { paidAt: "desc" },
              take: 5,
              select: { id: true, amountMinor: true, periodMonths: true, paidAt: true },
            },
          },
        },
        salons: { select: { id: true, name: true, slug: true }, take: 1 },
        _count: {
          select: { salons: { where: { status: { not: "DELETED" } } } },
        },
        memberships: {
          where: { role: "OWNER" },
          take: 1,
          select: { user: { select: { email: true } } },
        },
      },
    }),
    prisma.usageCounter.findMany({
      where: { periodYm },
      select: { salonId: true, bookings: true },
    }),
  ]);

  const bookingsBySalon = new Map(usage.map((u) => [u.salonId, u.bookings]));

  const rows: AccountRow[] = accounts.map((a) => {
    const sub = a.subscription;
    const salon = a.salons[0] ?? null;
    const effective = effectivePlan(sub ?? null);
    const extraBranches = sub?.extraBranches ?? 0;
    return {
      accountId: a.id,
      accountName: a.name,
      salonName: salon?.name ?? "—",
      slug: salon?.slug ?? null,
      ownerEmail: a.memberships[0]?.user.email ?? "—",
      createdLabel: formatBakuDate(bakuYmd(a.createdAt), df),
      plan: sub?.plan ?? "FREE",
      effective,
      status: sub?.status ?? null,
      extraBranches,
      branchCount: a._count.salons,
      // Same rule as the session: extras only count while multi-branch is on.
      branchLimit:
        limitsFor(effective).maxBranches +
        (featuresFor(effective).multiBranch ? extraBranches : 0),
      trialEndsLabel: sub?.trialEndsAt ? formatBakuDate(bakuYmd(sub.trialEndsAt), df) : null,
      periodEndLabel: sub?.currentPeriodEnd
        ? formatBakuDate(bakuYmd(sub.currentPeriodEnd), df)
        : null,
      bookingsThisMonth: salon ? (bookingsBySalon.get(salon.id) ?? 0) : 0,
      payments: (sub?.payments ?? []).map((p) => ({
        id: p.id,
        label: t("paymentLabel", {
          amount: (p.amountMinor / 100).toFixed(2),
          months: p.periodMonths,
          date: formatBakuDate(bakuYmd(p.paidAt), df),
        }),
      })),
    };
  });

  return <AdminAccounts rows={rows} />;
}

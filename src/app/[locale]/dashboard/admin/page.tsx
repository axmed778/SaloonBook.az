import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuYmd, formatBakuDate } from "@/lib/time";
import { effectivePlan } from "@/lib/subscription";
import { AdminAccounts, type AccountRow } from "./admin-accounts";

export const dynamic = "force-dynamic";

// Platform-admin panel: every account with its subscription truth (raw status
// AND the time-aware effective plan), this month's usage, payment history, and
// the manual "mark paid" action. Replaces the scripts/activate-plan.ts workflow
// with a UI (the script still works for emergencies).

export default async function AdminPage() {
  const session = (await getSession())!;
  if (!session.isAdmin) notFound();

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
            payments: {
              orderBy: { paidAt: "desc" },
              take: 5,
              select: { id: true, amountMinor: true, periodMonths: true, paidAt: true },
            },
          },
        },
        salons: { select: { id: true, name: true, slug: true }, take: 1 },
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
    return {
      accountId: a.id,
      accountName: a.name,
      salonName: salon?.name ?? "—",
      slug: salon?.slug ?? null,
      ownerEmail: a.memberships[0]?.user.email ?? "—",
      createdLabel: formatBakuDate(bakuYmd(a.createdAt)),
      plan: sub?.plan ?? "FREE",
      effective: effectivePlan(sub ?? null),
      status: sub?.status ?? null,
      trialEndsLabel: sub?.trialEndsAt ? formatBakuDate(bakuYmd(sub.trialEndsAt)) : null,
      periodEndLabel: sub?.currentPeriodEnd
        ? formatBakuDate(bakuYmd(sub.currentPeriodEnd))
        : null,
      bookingsThisMonth: salon ? (bookingsBySalon.get(salon.id) ?? 0) : 0,
      payments: (sub?.payments ?? []).map((p) => ({
        id: p.id,
        label: `${(p.amountMinor / 100).toFixed(2)} ₼ · ${p.periodMonths} ay · ${formatBakuDate(bakuYmd(p.paidAt))}`,
      })),
    };
  });

  return <AdminAccounts rows={rows} />;
}

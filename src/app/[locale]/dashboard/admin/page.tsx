import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuYmd, formatBakuDate } from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { effectivePlan } from "@/lib/subscription";
import { featuresFor, limitsFor } from "@/lib/plans";
import { maskPhone } from "@/lib/whatsapp-sender";
import { MAX_NOTIFICATION_ATTEMPTS } from "@/lib/queue";
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
  // Notification health. Until now an undelivered message was invisible
  // everywhere: the row went FAILED, nothing retried it, and no screen counted
  // it — the first signal was a salon asking why customers get nothing. The
  // sweep now revives FAILED rows, so what still matters is what it has GIVEN UP
  // on (attempts past the cap): those are dead letters that need a human.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60_000);
  const [accounts, usage, notifByStatus, deadLetters] = await Promise.all([
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
        salons: {
          select: {
            id: true,
            name: true,
            slug: true,
            // Own-number sender status (never select the encrypted token here).
            whatsAppSender: {
              select: { status: true, verifiedName: true, displayPhone: true },
            },
          },
          take: 1,
        },
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
    prisma.notification.groupBy({
      by: ["status"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    }),
    // Not time-boxed on purpose: a message nobody will ever retry stays a
    // problem after seven days, so it must not age out of this view.
    prisma.notification.count({
      where: { status: "FAILED", attempts: { gte: MAX_NOTIFICATION_ATTEMPTS } },
    }),
  ]);

  const notifCount = (status: string) =>
    notifByStatus.find((r) => r.status === status)?._count._all ?? 0;
  const notifSent = notifCount("SENT") + notifCount("DELIVERED") + notifCount("READ");
  const notifQueued = notifCount("QUEUED");
  const notifFailed = notifCount("FAILED");

  const bookingsBySalon = new Map(usage.map((u) => [u.salonId, u.bookings]));

  const rows: AccountRow[] = accounts.map((a) => {
    const sub = a.subscription;
    const salon = a.salons[0] ?? null;
    const effective = effectivePlan(sub ?? null);
    const extraBranches = sub?.extraBranches ?? 0;
    return {
      accountId: a.id,
      accountName: a.name,
      salonId: salon?.id ?? null,
      salonName: salon?.name ?? "—",
      slug: salon?.slug ?? null,
      // Own-number sender (Pro): status + safe-to-show display fields only.
      senderStatus: salon?.whatsAppSender?.status ?? null,
      senderVerifiedName: salon?.whatsAppSender?.verifiedName ?? null,
      senderPhoneMasked: maskPhone(salon?.whatsAppSender?.displayPhone),
      ownNumberEligible: featuresFor(effective).ownWhatsappNumber,
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

  return (
    <>
      <section className="mb-6 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold text-foreground">{t("notifications.title")}</h2>
        <dl className="mt-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("notifications.sent")}
            </dt>
            <dd className="font-semibold tabular-nums text-foreground">{notifSent}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("notifications.queued")}
            </dt>
            <dd className="font-semibold tabular-nums text-foreground">{notifQueued}</dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("notifications.failed")}
            </dt>
            <dd
              className={
                "font-semibold tabular-nums " +
                (notifFailed > 0 ? "text-amber-600 dark:text-amber-400" : "text-foreground")
              }
            >
              {notifFailed}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
              {t("notifications.dead")}
            </dt>
            <dd
              className={
                "font-semibold tabular-nums " +
                (deadLetters > 0 ? "text-rose-600 dark:text-rose-400" : "text-foreground")
              }
            >
              {deadLetters}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {deadLetters > 0
            ? t("notifications.deadHint", {
                count: deadLetters,
                max: MAX_NOTIFICATION_ATTEMPTS,
              })
            : t("notifications.healthy")}
        </p>
      </section>
      <AdminAccounts rows={rows} />
    </>
  );
}

// Compact trial/plan strip under the header: a single slim row with the
// countdown and a small CTA, escalating urgency (border + count colour) as the
// trial ends. Every branch is null-safe.
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { PLAN_LIMITS } from "@/lib/plans";

const BILLING_HREF = "/dashboard/billing";

function Cta({ children }: { children: string }) {
  return (
    <Link
      href={BILLING_HREF}
      className="inline-flex shrink-0 items-center rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-rose-400"
    >
      {children}
    </Link>
  );
}

export async function TrialNudge({
  status,
  daysLeft,
  planPriceMinor,
  planLabel,
  periodEndLabel,
}: {
  status: string | null;
  daysLeft: number | null;
  planPriceMinor: number;
  planLabel: string;
  periodEndLabel: string | null;
}) {
  const t = await getTranslations("Analytics.trial");
  const price = `${azn(planPriceMinor || PLAN_LIMITS.BASIC.priceMinor)} ₼`;

  // Active plan — quiet strip, no CTA.
  if (status === "ACTIVE") {
    return (
      <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-secondary-foreground">
        {t("active")} <span className="font-medium text-foreground">{planLabel}</span>
        {periodEndLabel ? t("nextPayment", { date: periodEndLabel }) : ""}
      </section>
    );
  }

  // Expired trial (live or already swept to FREE_DOWNGRADED) or unpaid subscription.
  if (
    (status === "TRIALING" && daysLeft === 0) ||
    status === "PAST_DUE" ||
    status === "FREE_DOWNGRADED"
  ) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3">
        <p className="text-sm text-rose-800 dark:text-rose-200">{t("trialEnded")}</p>
        <Cta>{t("activate")}</Cta>
      </section>
    );
  }

  // Trialing with days remaining — escalating urgency.
  if (status === "TRIALING" && daysLeft !== null && daysLeft > 0) {
    const tone =
      daysLeft > 14
        ? { border: "border-border", count: "text-secondary-foreground" }
        : daysLeft >= 4
          ? { border: "border-amber-500/40", count: "text-amber-700 dark:text-amber-300" }
          : { border: "border-rose-500/50 bg-rose-500/10", count: "text-rose-700 dark:text-rose-400" };

    return (
      <section
        className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border ${tone.border} px-4 py-3`}
      >
        <p className="text-sm text-secondary-foreground">
          {t.rich("endsIn", {
            days: daysLeft,
            price,
            n: (chunks) => <span className={`font-semibold ${tone.count}`}>{chunks}</span>,
          })}
        </p>
        <Cta>{t("activatePlan")}</Cta>
      </section>
    );
  }

  // No subscription / no trial end — generic strip.
  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {t("generic")}
      </p>
      <Cta>{t("viewPlans")}</Cta>
    </section>
  );
}

import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuToday, bakuYmd, formatBakuDate } from "@/lib/time";
import { MARKETING_PLANS, type MarketingPlanKey } from "@/lib/plans";
import { intlLocale } from "@/i18n/format";
import { azn } from "@/app/[locale]/dashboard/_components/calendar-shared";

export const dynamic = "force-dynamic";

// Manual billing: all payments go through the owner personally. Every CTA opens
// a WhatsApp chat with him (prefilled with the salon name); plans are then
// activated by hand. No online payment, no env var — one fixed support number.
const SUPPORT_WA = "994502990440";

function waLink(message: string): string {
  return `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent(message)}`;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.372-.025-.521-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.57-.085 1.758-.719 2.006-1.413.247-.694.247-1.29.173-1.414-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.002-5.45 4.437-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

type PlanCard = {
  key: MarketingPlanKey;
  name: string;
  tagline: string;
  priceMinor: number;
  features: string[];
  highlighted?: boolean;
};

export default async function BillingPage() {
  const session = (await getSession())!;
  const t = await getTranslations("Billing");
  const df = intlLocale(await getLocale());

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

  const PLANS: PlanCard[] = MARKETING_PLANS.map((p) => ({
    key: p.key,
    name: t(`plans.${p.key}.name`),
    tagline: t(`plans.${p.key}.tagline`),
    priceMinor: p.monthlyMinor,
    highlighted: p.highlight,
    features: t.raw(`plans.${p.key}.features`) as string[],
  }));

  const salon = await prisma.salon.findUnique({
    where: { id: session.salonId },
    select: { name: true, account: { select: { subscription: true } } },
  });
  const salonName = salon?.name ?? t("defaultSalonName");
  const sub = salon?.account?.subscription ?? null;

  // Trial days-left, Baku-safe (same rule as the analytics nudge).
  let daysLeft: number | null = null;
  if (sub?.trialEndsAt) {
    const [ay, am, ad] = bakuToday().split("-").map(Number);
    const [by, bm, bd] = bakuYmd(sub.trialEndsAt).split("-").map(Number);
    daysLeft = Math.max(
      0,
      Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000),
    );
  }
  // Internal enum → marketed tier name. BASIC is the standard paid/trial tier,
  // shown to owners as "Salon"; FREE is the internal floor (only reached when a
  // plan lapses, so it never surfaces as an ACTIVE label).
  const planLabel =
    sub?.plan === "PRO"
      ? t("plans.pro.name")
      : sub?.plan === "BASIC"
        ? t("plans.salon.name")
        : t("plans.start.name");
  const periodEndLabel = sub?.currentPeriodEnd
    ? formatBakuDate(bakuYmd(sub.currentPeriodEnd), df)
    : null;

  let statusLine: { text: string; tone: "emerald" | "amber" | "rose" } | null = null;
  if (sub?.status === "ACTIVE") {
    statusLine = {
      text: periodEndLabel
        ? t("status.activeWithPeriod", { plan: planLabel, date: periodEndLabel })
        : t("status.active", { plan: planLabel }),
      tone: "emerald",
    };
  } else if (sub?.status === "TRIALING" && daysLeft !== null) {
    statusLine =
      daysLeft > 0
        ? {
            text: t("status.trial", { days: daysLeft }),
            tone: daysLeft <= 3 ? "rose" : "amber",
          }
        : { text: t("status.trialEnded"), tone: "rose" };
  } else if (sub?.status === "PAST_DUE") {
    statusLine = { text: t("status.pastDue"), tone: "rose" };
  } else if (sub?.status === "FREE_DOWNGRADED") {
    statusLine = { text: t("status.freeDowngraded"), tone: "rose" };
  }

  const statusToneCls: Record<"emerald" | "amber" | "rose", string> = {
    emerald: "border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-200",
    amber: "border-amber-500/40 bg-amber-500/5 text-amber-800 dark:text-amber-200",
    rose: "border-rose-500/50 bg-rose-500/10 text-rose-800 dark:text-rose-200",
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <div>
        <h1 className="text-lg font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-0.5 text-sm text-faint-foreground">
          {t("subtitle")}
        </p>
      </div>

      {statusLine && (
        <div className={`rounded-xl border p-4 text-sm ${statusToneCls[statusLine.tone]}`}>
          {statusLine.text}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {PLANS.map((p) => (
          <div
            key={p.key}
            className={
              "flex flex-col justify-between rounded-xl border bg-card p-5 " +
              (p.highlighted ? "border-rose-500/40" : "border-border")
            }
          >
            <div>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-foreground">{p.name}</h2>
                {p.highlighted && (
                  <span className="rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-medium text-rose-700 dark:text-rose-300">
                    {t("recommended")}
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs text-faint-foreground">{p.tagline}</p>
              <p className="mt-3">
                <span className="text-3xl font-semibold text-foreground">{azn(p.priceMinor)} ₼</span>
                <span className="text-sm text-faint-foreground"> {t("perMonth")}</span>
              </p>
              <ul className="mt-4 space-y-2">
                {p.features.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-secondary-foreground">
                    <svg
                      className="mt-0.5 h-4 w-4 shrink-0 text-rose-700 dark:text-rose-400"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
            <a
              href={waLink(t("waActivate", { salon: salonName, plan: p.name }))}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-5 inline-flex items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500"
            >
              <WhatsAppIcon className="h-4 w-4" />
              {t("choosePlan", { plan: p.name })}
            </a>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-card p-5">
        <div>
          <p className="font-medium text-foreground">{t("questionsTitle")}</p>
          <p className="mt-0.5 text-sm text-faint-foreground">
            {t("questionsBody")}
          </p>
        </div>
        <a
          href={waLink(t("waQuestion", { salon: salonName }))}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-lg bg-[#25D366] px-4 py-2.5 text-sm font-semibold text-[#0b141a] transition hover:brightness-95"
        >
          <WhatsAppIcon className="h-5 w-5" />
          {t("writeOnWhatsapp")}
        </a>
      </div>
    </div>
  );
}

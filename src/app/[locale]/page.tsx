import {
  ArrowRight,
  BarChart3,
  CalendarCheck,
  CalendarClock,
  Check,
  Clock,
  MessageCircle,
  Scissors,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Users,
  X,
} from "lucide-react";
import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { MARKETING_PLANS, type MarketingPlan } from "@/lib/plans";
import { cn } from "@/lib/cn";
import { ButtonLink, Eyebrow, SectionHeader } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Faq } from "@/components/faq";
import { ProWhatsAppToggle } from "@/components/pro-whatsapp-toggle";
import heroBookingDark from "../../../public/hero/booking-dark.png";
import heroBookingLight from "../../../public/hero/booking-light.png";

type Row = { label: string; value: boolean | string; id?: string };

/** Pro-only: labels/values for the embedded "own number" WhatsApp toggle. */
type WhatsAppToggle = {
  ourLabel: string;
  ownLabel: string;
  ownValue: string;
  /** Caveat shown when "own number" is selected (Meta costs paid by the salon). */
  ownNote: string;
};

/* ------------------------------ Primitives ------------------------------- */

function FeatureCard({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof CalendarClock;
  title: string;
  body: string;
}) {
  return (
    <div className="group rounded-xl border border-border bg-card p-6 shadow-soft transition-colors duration-200 hover:border-border-strong hover:bg-hover">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-accent transition-colors group-hover:border-border-strong">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <h3 className="mt-5 text-base font-medium text-foreground">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function PricingCard({
  plan,
  rows,
  perMonth,
  annualLabel,
  whatsappToggle,
}: {
  plan: {
    name: string;
    tagline: string;
    cta: string;
    note: string;
    highlight: boolean;
    badge: string | null;
    monthlyMinor: number;
  };
  rows: Row[];
  perMonth: string;
  annualLabel: string;
  whatsappToggle?: WhatsAppToggle;
}) {
  const price = (plan.monthlyMinor / 100).toString();

  return (
    <div
      className={cn(
        "relative flex flex-col rounded-xl border p-6",
        plan.highlight
          ? "border-accent/40 bg-card shadow-frame ring-1 ring-accent/20"
          : "border-border bg-card shadow-soft",
      )}
    >
      {plan.badge && (
        <span className="absolute -top-3 left-6 inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-xs font-medium text-accent-foreground shadow-sm">
          <Star className="h-3 w-3" strokeWidth={2.5} />
          {plan.badge}
        </span>
      )}

      <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{plan.tagline}</p>

      <div className="mt-5 flex items-baseline gap-1.5">
        <span className="text-4xl font-semibold tracking-tight text-foreground">
          {price} ₼
        </span>
        <span className="text-sm text-muted-foreground">{perMonth}</span>
      </div>
      <p className="mt-1.5 text-sm text-muted-foreground">{annualLabel}</p>

      <ButtonLink
        href="/register"
        variant={plan.highlight ? "primary" : "secondary"}
        className="mt-6 w-full"
      >
        {plan.cta}
      </ButtonLink>
      <p className="mt-3 text-center text-xs text-muted-foreground">{plan.note}</p>

      <ul className="mt-7 space-y-3 border-t border-border pt-6">
        {rows.map((row) => {
          const included = row.value !== false;
          const isToggle =
            row.id === "whatsapp" && whatsappToggle && typeof row.value === "string";
          return (
            <li
              key={row.label}
              className={cn(
                "flex items-start gap-2.5 text-sm",
                included ? "text-foreground" : "text-faint-foreground",
              )}
            >
              {included ? (
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" strokeWidth={2.5} />
              ) : (
                <X className="mt-0.5 h-4 w-4 shrink-0 text-border-strong" strokeWidth={2} />
              )}
              {isToggle ? (
                <ProWhatsAppToggle
                  label={row.label}
                  ourLabel={whatsappToggle.ourLabel}
                  ownLabel={whatsappToggle.ownLabel}
                  ourValue={row.value as string}
                  ownValue={whatsappToggle.ownValue}
                  ownNote={whatsappToggle.ownNote}
                />
              ) : (
                <span>
                  {row.label}
                  {typeof row.value === "string" && (
                    <span className="text-muted-foreground"> — {row.value}</span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* --------------------------------- Page ---------------------------------- */

export default async function Home() {
  const t = await getTranslations("Landing");

  const fmtLimit = (n: number) => (n === Infinity ? t("pricing.unlimited") : String(n));

  const features = [
    { icon: CalendarClock, key: "booking" },
    { icon: MessageCircle, key: "whatsapp" },
    { icon: ShieldCheck, key: "overlap" },
    { icon: Users, key: "team" },
    { icon: Clock, key: "slots" },
    { icon: BarChart3, key: "roi" },
  ] as const;

  const steps = [
    { icon: Scissors, key: "profile" },
    { icon: Share2, key: "share" },
    { icon: CalendarCheck, key: "accept" },
  ] as const;

  const plans = MARKETING_PLANS;

  function planRows(plan: MarketingPlan): Row[] {
    return [
      { label: t("pricing.rows.employees"), value: fmtLimit(plan.maxEmployees) },
      { label: t("pricing.rows.monthlyBookings"), value: t("pricing.unlimited") },
      { label: t("pricing.rows.branches"), value: fmtLimit(plan.maxBranches) },
      {
        id: "whatsapp",
        label: t("pricing.rows.whatsappReminders"),
        value: t("pricing.rows.whatsappRemindersValue", { count: plan.waRemindersPerMonth }),
      },
      { label: t("pricing.rows.onlineBooking"), value: true },
      { label: t("pricing.rows.overlapProtection"), value: true },
      { label: t("pricing.rows.roiPanel"), value: true },
      { label: t("pricing.rows.payroll"), value: plan.advanced },
      { label: t("pricing.rows.roles"), value: plan.advanced },
      { label: t("pricing.rows.exports"), value: plan.advanced },
      { label: t("pricing.rows.deposits"), value: plan.advanced },
    ];
  }

  return (
    <>
      <SiteHeader />

      <main>
        {/* ---------------------------- Hero ---------------------------- */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid mask-radial-faded" />
            <div className="absolute inset-x-0 top-0 h-[600px] glow-accent" />
          </div>

          <div className="mx-auto max-w-6xl px-6 pb-20 pt-20 sm:pt-28">
            <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
              <a
                href="#pricing"
                className="group inline-flex items-center gap-2 rounded-full border border-border bg-card py-1 pl-1.5 pr-3 text-sm text-muted-foreground shadow-soft transition-colors hover:border-border-strong hover:bg-hover"
              >
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">
                  <Sparkles className="h-3 w-3" strokeWidth={2} />
                  {t("badgeNew")}
                </span>
                {t("badgePromo")}
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </a>

              <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
                {t("heroTitle")}
              </h1>

              <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
                {t("heroSubtitle")}
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/register" variant="primary" size="lg">
                  {t("ctaStartFree")}
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </ButtonLink>
                <ButtonLink href="/demostudio" variant="secondary" size="lg">
                  {t("ctaViewDemo")}
                </ButtonLink>
              </div>

              <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {[t("heroChecks.trial"), t("heroChecks.noCard"), t("heroChecks.moneyBack")].map(
                  (item) => (
                    <li key={item} className="inline-flex items-center gap-1.5">
                      <Check className="h-4 w-4 text-accent" strokeWidth={2.5} />
                      {item}
                    </li>
                  ),
                )}
              </ul>
            </div>

            {/* Real product screenshot: the live /demostudio booking flow at the
                time-slot step (captured per theme), cropped with a fade so the
                hero stays compact. */}
            <div className="relative mx-auto mt-16 max-w-2xl">
              <div className="pointer-events-none absolute -inset-x-8 -top-8 bottom-0 -z-10 glow-accent opacity-60" />
              <div className="relative max-h-[680px] overflow-hidden rounded-xl border border-border bg-card shadow-frame">
                <Image
                  src={heroBookingDark}
                  alt={t("heroImageAlt")}
                  priority
                  placeholder="blur"
                  className="hero-shot-dark w-full"
                  sizes="(max-width: 768px) 100vw, 672px"
                />
                <Image
                  src={heroBookingLight}
                  alt={t("heroImageAlt")}
                  priority
                  placeholder="blur"
                  className="hero-shot-light w-full"
                  sizes="(max-width: 768px) 100vw, 672px"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background to-transparent" />
              </div>
            </div>
          </div>
        </section>

        {/* -------------------------- Features -------------------------- */}
        <section id="features" className="scroll-mt-24 border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <SectionHeader
              eyebrow={t("features.eyebrow")}
              title={t("features.title")}
              subtitle={t("features.subtitle")}
            />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <FeatureCard
                  key={f.key}
                  icon={f.icon}
                  title={t(`features.items.${f.key}.title`)}
                  body={t(`features.items.${f.key}.body`)}
                />
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------ How it works ------------------------ */}
        <section id="how" className="scroll-mt-24 border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <SectionHeader
              eyebrow={t("steps.eyebrow")}
              title={t("steps.title")}
              subtitle={t("steps.subtitle")}
            />
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {steps.map((step, i) => (
                <div
                  key={step.key}
                  className="relative rounded-xl border border-border bg-card p-6 shadow-soft"
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-muted text-accent">
                      <step.icon className="h-5 w-5" strokeWidth={1.75} />
                    </span>
                    <span className="font-mono text-sm text-faint-foreground">
                      0{i + 1}
                    </span>
                  </div>
                  <h3 className="mt-5 text-base font-medium text-foreground">
                    {t(`steps.items.${step.key}.title`)}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {t(`steps.items.${step.key}.body`)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* -------------------------- Pricing --------------------------- */}
        <section id="pricing" className="scroll-mt-24 border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <SectionHeader
              eyebrow={t("pricing.eyebrow")}
              title={t("pricing.title")}
              subtitle={t("pricing.subtitle")}
            />
            <div className="mt-16 grid gap-5 lg:grid-cols-3">
              {plans.map((plan) => (
                <PricingCard
                  key={plan.key}
                  plan={{
                    name: t(`pricing.plans.${plan.key}.name`),
                    tagline: t(`pricing.plans.${plan.key}.tagline`),
                    cta: t(`pricing.plans.${plan.key}.cta`),
                    note: t(`pricing.plans.${plan.key}.note`),
                    highlight: plan.highlight,
                    badge: plan.popular ? t(`pricing.plans.${plan.key}.badge`) : null,
                    monthlyMinor: plan.monthlyMinor,
                  }}
                  rows={planRows(plan)}
                  perMonth={t("pricing.perMonth")}
                  annualLabel={t("pricing.annual", { price: plan.annualMinor / 100 })}
                  whatsappToggle={
                    plan.key === "pro"
                      ? {
                          ourLabel: t("pricing.rows.whatsappOwnToggleOur"),
                          ownLabel: t("pricing.rows.whatsappOwnToggleOwn"),
                          ownValue: t("pricing.rows.whatsappOwnValue"),
                          ownNote: t("pricing.rows.whatsappOwnNote"),
                        }
                      : undefined
                  }
                />
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              {t("pricing.footnote")}
            </p>
          </div>
        </section>

        {/* ---------------------------- FAQ ----------------------------- */}
        <section id="faq" className="scroll-mt-24 border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <SectionHeader
              eyebrow={t("faq.eyebrow")}
              title={t("faq.title")}
              subtitle={t("faq.subtitle")}
              className="mb-14"
            />
            <Faq />
          </div>
        </section>

        {/* ------------------------- Final CTA -------------------------- */}
        <section className="relative overflow-hidden border-t border-border">
          <div className="pointer-events-none absolute inset-0 -z-10">
            <div className="absolute inset-0 bg-grid mask-radial-faded opacity-60" />
            <div className="absolute inset-x-0 top-0 h-[400px] glow-accent" />
          </div>
          <div className="mx-auto max-w-3xl px-6 py-24 text-center sm:py-32">
            <Eyebrow className="justify-center">{t("finalCta.eyebrow")}</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              {t("finalCta.title")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              {t("finalCta.subtitle")}
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/register" variant="primary" size="lg">
                {t("finalCta.ctaStartFree")}
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </ButtonLink>
              <ButtonLink href="/demostudio" variant="secondary" size="lg">
                {t("finalCta.ctaViewDemo")}
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

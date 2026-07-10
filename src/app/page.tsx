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
import { PLAN_FEATURES, PLAN_LIMITS } from "@/lib/plans";
import { cn } from "@/lib/cn";
import { ButtonLink, Eyebrow, SectionHeader } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Faq } from "@/components/faq";
import heroBookingDark from "../../public/hero/booking-dark.png";
import heroBookingLight from "../../public/hero/booking-light.png";

/* ------------------------------- Content --------------------------------- */

const FEATURES = [
  {
    icon: CalendarClock,
    title: "24/7 onlayn qeydiyyat",
    body: "Müştərilər gecə-gündüz, sizdən asılı olmadan özləri boş vaxt seçib yer ayırır.",
  },
  {
    icon: MessageCircle,
    title: "WhatsApp xatırlatmaları",
    body: "Avtomatik təsdiq və xatırlatma mesajları — gəlməyənlərin (no-show) sayı azalır.",
  },
  {
    icon: ShieldCheck,
    title: "İkiqat rezervasiya qoruması",
    body: "Eyni usta üçün üst-üstə düşən görüş mümkün deyil — verilənlər bazası səviyyəsində.",
  },
  {
    icon: Users,
    title: "Komanda və xidmətlər",
    body: "Hər usta üçün ayrıca iş saatları, xidmət müddəti və aralarındakı bufer vaxtı.",
  },
  {
    icon: Clock,
    title: "Ağıllı boş vaxtlar",
    body: "Mövcud slotlar müddət və bufer əsasında real vaxtda, dəqiq hesablanır.",
  },
  {
    icon: BarChart3,
    title: "ROI analitika",
    body: "Onlayn qeydiyyatın qazandırdığı gəlir, qayıdan müştərilər və ən gəlirli xidmətlər — bir baxışda, bütün planlarda.",
  },
];

const STEPS = [
  {
    icon: Scissors,
    title: "Profilini qur",
    body: "Xidmətləri, ustaları və iş saatlarını əlavə et — bir neçə dəqiqəyə.",
  },
  {
    icon: Share2,
    title: "Linkini paylaş",
    body: "Şəxsi qeydiyyat linkini Instagram bio və ya WhatsApp-da yerləşdir.",
  },
  {
    icon: CalendarCheck,
    title: "Rezervasiyaları qəbul et",
    body: "Təqvim avtomatik dolur, xatırlatmalar özü gedir. Sən işinə fokuslan.",
  },
];

type Row = { label: string; value: boolean | string };

const fmtLimit = (n: number) => (n === Infinity ? "Limitsiz" : String(n));

function planRows(id: "FREE" | "BASIC" | "PRO"): Row[] {
  const lim = PLAN_LIMITS[id];
  const feat = PLAN_FEATURES[id];
  return [
    { label: "İşçi", value: fmtLimit(lim.maxEmployees) },
    { label: "Aylıq rezervasiya", value: fmtLimit(lim.maxBookingsPerMonth) },
    { label: "Filial", value: fmtLimit(lim.maxBranches) },
    { label: "24/7 onlayn qeydiyyat", value: true },
    { label: "WhatsApp xatırlatmaları", value: true },
    { label: "İkiqat rezervasiya qoruması", value: true },
    { label: "ROI analitika paneli", value: true },
    { label: "Əməkhaqqı modulu (maaş + komissiya)", value: feat.payroll },
    { label: "Rol idarəetməsi (tezliklə)", value: feat.staffRoles },
    { label: "Məlumat eksportu (tezliklə)", value: feat.exports },
    { label: "Depozit / no-show qoruması (tezliklə)", value: feat.deposits },
  ];
}

const PLANS = [
  {
    id: "FREE" as const,
    name: "Pulsuz",
    tagline: "Başlamaq üçün",
    cta: "Pulsuz başla",
    note: "Kart tələb olunmur",
    highlight: false,
    badge: null,
  },
  {
    id: "BASIC" as const,
    name: "Basic",
    tagline: "Aktiv salonlar üçün",
    cta: "Basic seç",
    note: "EARLYBIRD ilə ilk 3 ay pulsuz",
    highlight: true,
    badge: "Populyar",
  },
  {
    id: "PRO" as const,
    name: "Pro",
    tagline: "Böyüyən komandalar üçün",
    cta: "Pro seç",
    note: "İstənilən vaxt ləğv et",
    highlight: false,
    badge: null,
  },
];

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

function PricingCard({ plan }: { plan: (typeof PLANS)[number] }) {
  const price = (PLAN_LIMITS[plan.id].priceMinor / 100).toString();
  const rows = planRows(plan.id);

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
        <span className="text-sm text-muted-foreground">/ay</span>
      </div>

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
              <span>
                {row.label}
                {typeof row.value === "string" && (
                  <span className="text-muted-foreground"> — {row.value}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* --------------------------------- Page ---------------------------------- */

export default function Home() {
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
                  Yeni
                </span>
                EARLYBIRD ilə 3 ay pulsuz
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </a>

              <h1 className="mt-6 text-balance text-4xl font-semibold leading-[1.1] tracking-tight text-foreground sm:text-6xl">
                Müştərilər özləri qeydiyyatdan keçsin — 24/7.
              </h1>

              <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
                Instagram və WhatsApp-da qeydiyyat mesajlarına cavab verməyi
                dayandırın. Salonunuz üçün şəxsi link yaradın, paylaşın —
                qalanını biz edirik.
              </p>

              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <ButtonLink href="/register" variant="primary" size="lg">
                  Pulsuz başla
                  <ArrowRight className="h-4 w-4" strokeWidth={2} />
                </ButtonLink>
                <ButtonLink href="/demostudio" variant="secondary" size="lg">
                  Nümunə səhifəyə bax
                </ButtonLink>
              </div>

              <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
                {["Kart tələb olunmur", "Dəqiqələrə quraşdır", "İstənilən vaxt ləğv et"].map(
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
                  alt="SalonBook.az onlayn qeydiyyat səhifəsi — xidmət, usta və boş vaxt seçimi"
                  priority
                  placeholder="blur"
                  className="hero-shot-dark w-full"
                  sizes="(max-width: 768px) 100vw, 672px"
                />
                <Image
                  src={heroBookingLight}
                  alt="SalonBook.az onlayn qeydiyyat səhifəsi — xidmət, usta və boş vaxt seçimi"
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
              eyebrow="İmkanlar"
              title="Qeydiyyat üçün lazım olan hər şey"
              subtitle="Mesajlaşmanı dayandıran, masanı dolduran və komandanı sinxron saxlayan sadə alətlər."
            />
            <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <FeatureCard key={f.title} {...f} />
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------ How it works ------------------------ */}
        <section id="how" className="scroll-mt-24 border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <SectionHeader
              eyebrow="Necə işləyir"
              title="Üç addımda işə başla"
              subtitle="Quraşdırma dəqiqələr çəkir. Texniki bilik tələb olunmur."
            />
            <div className="mt-14 grid gap-4 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <div
                  key={step.title}
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
                    {step.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {step.body}
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
              eyebrow="Qiymətlər"
              title="Sadə, şəffaf qiymət"
              subtitle="Pulsuz başla, böyüdükcə yüksəl. Gizli ödəniş yoxdur."
            />
            <div className="mt-16 grid gap-5 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <PricingCard key={plan.id} plan={plan} />
              ))}
            </div>
            <p className="mt-8 text-center text-sm text-muted-foreground">
              Bütün qiymətlər AZN-dədir. Ödənişlər hazırda manual aktivləşdirilir.
            </p>
          </div>
        </section>

        {/* ---------------------------- FAQ ----------------------------- */}
        <section id="faq" className="scroll-mt-24 border-t border-border">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <SectionHeader
              eyebrow="FAQ"
              title="Tez-tez verilən suallar"
              subtitle="Axtardığınızı tapmadınız? Bizə yazın — kömək edək."
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
            <Eyebrow className="justify-center">Hazırsınız?</Eyebrow>
            <h2 className="mx-auto mt-4 max-w-2xl text-balance text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Bu gün öz qeydiyyat linkinizi yaradın
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
              Dəqiqələr ərzində qurun, müştərilərinizlə paylaşın və rezervasiyaların
              özü-özünə gəlməsini izləyin.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <ButtonLink href="/register" variant="primary" size="lg">
                Pulsuz başla
                <ArrowRight className="h-4 w-4" strokeWidth={2} />
              </ButtonLink>
              <ButtonLink href="/demostudio" variant="secondary" size="lg">
                Əvvəlcə nümunəyə bax
              </ButtonLink>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}

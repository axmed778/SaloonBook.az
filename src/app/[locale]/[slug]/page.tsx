import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { getTranslations, getLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import type { Audience } from "@/lib/audience";
import { bakuToday, shiftYmd } from "@/lib/time";
import { effectivePlan } from "@/lib/subscription";
import { featuresFor } from "@/lib/plans";
import { intlLocale, ogLocale } from "@/i18n/format";
import { ButtonLink } from "@/components/ui";
import { Logo } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageSwitcher } from "@/components/language-switcher";
import { BookingWidget } from "./booking-widget";
import { BranchPicker } from "./branch-picker";

export const dynamic = "force-dynamic";

// Per-salon Open Graph metadata: a shared booking link is the salon's growth
// loop, so the preview must show THEIR salon, not generic boilerplate. The OG
// image itself is rendered per-salon in ./opengraph-image.tsx.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  const t = await getTranslations({ locale, namespace: "SalonPage" });
  const salon = await prisma.salon.findUnique({
    where: { slug },
    select: { name: true, description: true, address: true, status: true },
  });
  if (!salon || salon.status !== "ACTIVE") {
    return { title: t("metaNotFound"), robots: { index: false } };
  }

  const title = `${salon.name} — ${t("metaTitleSuffix")}`;
  const addr = salon.address ? ` · ${salon.address}` : "";
  const description =
    salon.description?.trim() || t("metaDescription", { name: salon.name, addr });
  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

  return {
    title: `${title} | SalonBook.az`,
    description,
    metadataBase: new URL(appUrl),
    alternates: { canonical: `/${slug}` },
    openGraph: {
      title,
      description,
      url: `/${slug}`,
      siteName: "SalonBook.az",
      locale: ogLocale(locale),
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { slug } = await params;
  const { branch: branchParam } = await searchParams;
  const t = await getTranslations("SalonPage");
  const locale = await getLocale();

  const salon = await prisma.salon.findUnique({
    where: { slug },
    select: {
      id: true,
      name: true,
      description: true,
      address: true,
      phone: true,
      status: true,
      audience: true,
      account: {
        select: {
          subscription: {
            select: { plan: true, status: true, trialEndsAt: true, currentPeriodEnd: true },
          },
          salons: {
            where: { status: "ACTIVE" },
            orderBy: { createdAt: "asc" },
            select: { id: true, slug: true, name: true, address: true, audience: true },
          },
        },
      },
    },
  });

  if (!salon || salon.status !== "ACTIVE") notFound();

  // Multi-branch (Pro): the account shares ONE public link, so this page offers
  // a branch dropdown when the account has 2+ ACTIVE branches. ?branch=<slug>
  // picks one (validated against the account's own list); the default is the
  // salon the link points at. Non-Pro accounts never see the picker — their
  // extra branches (if any, after a downgrade) stay unreachable here.
  const plan = effectivePlan(salon.account.subscription);
  const siblings = salon.account.salons;
  const branches =
    featuresFor(plan).multiBranch && siblings.length > 1 ? siblings : null;
  const selected =
    branches?.find((b) => b.slug === branchParam) ??
    siblings.find((b) => b.id === salon.id) ??
    { id: salon.id, slug, name: salon.name, address: salon.address, audience: salon.audience };

  // Catalog of the SELECTED branch (each branch has its own staff + services).
  const [services, employees] = await Promise.all([
    prisma.service.findMany({
      where: { salonId: selected.id, isActive: true },
      select: { id: true, name: true, priceMinor: true, durationMin: true, audience: true },
      orderBy: { name: "asc" },
    }),
    prisma.employee.findMany({
      where: { salonId: selected.id, isActive: true },
      select: {
        id: true,
        name: true,
        position: true,
        audience: true,
        services: { select: { serviceId: true } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  // Next 14 Baku days for the booking date picker (availability is validated
  // server-side, so past/closed days simply return no slots).
  const days = Array.from({ length: 14 }, (_, i) => {
    const ymd = shiftYmd(bakuToday(), i);
    const [y, m, d] = ymd.split("-").map(Number);
    const label = new Intl.DateTimeFormat(intlLocale(locale), {
      timeZone: "Asia/Baku",
      day: "numeric",
      month: "short",
      weekday: "short",
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
    return { ymd, label };
  });

  const bookingServices = services.map((s) => ({
    id: s.id,
    name: s.name,
    priceMinor: s.priceMinor,
    durationMin: s.durationMin,
    audience: s.audience as Audience,
  }));
  const bookingEmployees = employees.map((e) => ({
    id: e.id,
    name: e.name,
    position: e.position,
    audience: e.audience as Audience,
    serviceIds: e.services.map((se) => se.serviceId),
  }));

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const prices = bookingServices.map((s) => s.priceMinor).filter((p) => p > 0);
  // LocalBusiness structured data for the SELECTED branch — helps the salon
  // surface in local/maps results (a booking link is their growth loop).
  const salonJsonLd = {
    "@context": "https://schema.org",
    "@type": "HealthAndBeautyBusiness",
    name: selected.name,
    url: `${appUrl}/${selected.slug}`,
    image: `${appUrl}/hero/booking-dark.png`,
    areaServed: "AZ",
    ...(salon.description ? { description: salon.description } : {}),
    ...(selected.address
      ? { address: { "@type": "PostalAddress", streetAddress: selected.address, addressCountry: "AZ" } }
      : {}),
    ...(salon.phone ? { telephone: salon.phone } : {}),
    ...(prices.length
      ? { priceRange: `${Math.min(...prices) / 100}–${Math.max(...prices) / 100} AZN` }
      : {}),
    potentialAction: { "@type": "ReserveAction", target: `${appUrl}/${selected.slug}` },
  };

  return (
    <div className="relative min-h-screen">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(salonJsonLd) }}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] glow-accent opacity-70" />

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ThemeToggle />
            <ButtonLink href="/register" variant="ghost" size="sm" className="hidden sm:inline-flex">
              {t("createOwn")}
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
        {/* Salon header */}
        <div className="flex items-start gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-lg font-semibold text-accent shadow-soft">
            {initials(salon.name)}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {salon.name}
              </h1>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-2.5 py-1 text-xs font-medium text-success">
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                {t("open")}
              </span>
            </div>
            {salon.description && (
              <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">
                {salon.description}
              </p>
            )}
          </div>
        </div>

        {/* Branch choice (Pro multi-branch): which location does the client
            want to visit? One link — the dropdown swaps the catalog below. */}
        {branches && (
          <BranchPicker
            branches={branches.map((b) => ({
              slug: b.slug,
              name: b.name,
              address: b.address,
            }))}
            activeSlug={selected.slug}
          />
        )}

        {/* Booking flow — the whole page is the booking widget. Keyed by branch
            so switching remounts it (stale service/employee ids must not leak
            across branches); its API calls use the branch's own internal slug. */}
        <BookingWidget
          key={selected.id}
          slug={selected.slug}
          salonAudience={selected.audience as Audience}
          services={bookingServices}
          employees={bookingEmployees}
          days={days}
        />

        <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-sm text-faint-foreground">
          <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
          {t("poweredBy")}
        </p>
      </main>
    </div>
  );
}

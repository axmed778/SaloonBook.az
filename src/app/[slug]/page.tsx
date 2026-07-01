import { notFound } from "next/navigation";
import { Clock, MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import {
  parseBusinessHours,
  WEEKDAYS_ORDER,
  WEEKDAY_LABEL,
  minToHHMM,
} from "@/lib/business-hours";
import type { Audience } from "@/lib/audience";
import { bakuToday, shiftYmd } from "@/lib/time";
import { ButtonLink, Eyebrow } from "@/components/ui";
import { Logo } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { BookingWidget } from "./booking-widget";

export const dynamic = "force-dynamic";

const formatAzn = (minor: number) => {
  const v = minor / 100;
  return Number.isInteger(v) ? v.toString() : v.toFixed(2);
};

const initials = (name: string) =>
  name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

export default async function BookingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const salon = await prisma.salon.findUnique({
    where: { slug },
    select: {
      name: true,
      description: true,
      status: true,
      businessHours: true,
      audience: true,
      services: {
        where: { isActive: true },
        select: { id: true, name: true, priceMinor: true, durationMin: true, audience: true },
        orderBy: { name: "asc" },
      },
      employees: {
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          position: true,
          audience: true,
          services: { select: { serviceId: true } },
        },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!salon || salon.status !== "ACTIVE") notFound();

  const businessHours = parseBusinessHours(salon.businessHours);

  // Next 14 Baku days for the booking date picker (availability is validated
  // server-side, so past/closed days simply return no slots).
  const days = Array.from({ length: 14 }, (_, i) => {
    const ymd = shiftYmd(bakuToday(), i);
    const [y, m, d] = ymd.split("-").map(Number);
    const label = new Intl.DateTimeFormat("az-AZ", {
      timeZone: "Asia/Baku",
      day: "numeric",
      month: "short",
      weekday: "short",
    }).format(new Date(Date.UTC(y, m - 1, d, 12)));
    return { ymd, label };
  });

  const bookingServices = salon.services.map((s) => ({
    id: s.id,
    name: s.name,
    priceMinor: s.priceMinor,
    durationMin: s.durationMin,
    audience: s.audience as Audience,
  }));
  const bookingEmployees = salon.employees.map((e) => ({
    id: e.id,
    name: e.name,
    position: e.position,
    audience: e.audience as Audience,
    serviceIds: e.services.map((se) => se.serviceId),
  }));

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] glow-accent opacity-70" />

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ButtonLink href="/register" variant="ghost" size="sm">
              Öz salonunu yarat
            </ButtonLink>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
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
                Açıqdır
              </span>
            </div>
            {salon.description && (
              <p className="mt-2 text-pretty leading-relaxed text-muted-foreground">
                {salon.description}
              </p>
            )}
          </div>
        </div>

        {/* Services */}
        <section className="mt-12">
          <Eyebrow>Xidmətlər</Eyebrow>
          <ul className="mt-4 space-y-2">
            {salon.services.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card px-4 py-3.5 shadow-soft transition-colors hover:border-border-strong hover:bg-hover"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{s.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Clock className="h-3.5 w-3.5" strokeWidth={2} />
                    {s.durationMin} dəq
                  </p>
                </div>
                <span className="shrink-0 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm font-medium text-foreground">
                  {formatAzn(s.priceMinor)} ₼
                </span>
              </li>
            ))}
            {salon.services.length === 0 && (
              <li className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Xidmət əlavə edilməyib.
              </li>
            )}
          </ul>
        </section>

        {/* Staff */}
        <section className="mt-10">
          <Eyebrow>Mütəxəssislər</Eyebrow>
          {salon.employees.length > 0 ? (
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {salon.employees.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-soft"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-medium text-secondary-foreground">
                    {initials(e.name)}
                  </span>
                  <div className="min-w-0 leading-tight">
                    <p className="truncate text-sm font-medium text-foreground">{e.name}</p>
                    {e.position && (
                      <p className="truncate text-xs text-muted-foreground">{e.position}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
              Mütəxəssis əlavə edilməyib.
            </p>
          )}
        </section>

        {/* Business hours */}
        {businessHours.length > 0 && (
          <section className="mt-10">
            <Eyebrow>İş saatları</Eyebrow>
            <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
              {WEEKDAYS_ORDER.map((weekday) => {
                const h = businessHours.find((b) => b.weekday === weekday);
                return (
                  <li key={weekday} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="text-muted-foreground">{WEEKDAY_LABEL[weekday]}</span>
                    {h ? (
                      <span className="font-medium text-foreground">
                        {minToHHMM(h.openMin)} – {minToHHMM(h.closeMin)}
                      </span>
                    ) : (
                      <span className="text-faint-foreground">Bağlı</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {/* Booking flow */}
        <BookingWidget
          slug={slug}
          salonAudience={salon.audience as Audience}
          services={bookingServices}
          employees={bookingEmployees}
          days={days}
        />

        <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-sm text-faint-foreground">
          <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
          SalonBook.az ilə gücləndirilib
        </p>
      </main>
    </div>
  );
}

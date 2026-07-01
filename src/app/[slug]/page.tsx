import { notFound } from "next/navigation";
import { MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import type { Audience } from "@/lib/audience";
import { bakuToday, shiftYmd } from "@/lib/time";
import { ButtonLink } from "@/components/ui";
import { Logo } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { BookingWidget } from "./booking-widget";

export const dynamic = "force-dynamic";

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
        <div className="mx-auto flex h-16 max-w-2xl items-center justify-between px-6">
          <Logo />
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ButtonLink href="/register" variant="ghost" size="sm">
              Öz salonunu yarat
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

        {/* Booking flow — the whole page is the booking widget */}
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

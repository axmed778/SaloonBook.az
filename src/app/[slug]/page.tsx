import { notFound } from "next/navigation";
import { Clock, Info, MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { ButtonLink, Eyebrow } from "@/components/ui";
import { Logo } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";

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
      services: {
        where: { isActive: true },
        select: { id: true, name: true, priceMinor: true, durationMin: true },
        orderBy: { name: "asc" },
      },
      employees: {
        where: { isActive: true },
        select: { id: true, name: true, position: true },
        orderBy: { name: "asc" },
      },
    },
  });

  if (!salon || salon.status !== "ACTIVE") notFound();

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

        {/* Booking flow placeholder */}
        <div className="mt-12 rounded-xl border border-border bg-card p-5 shadow-soft">
          <div className="flex gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-accent">
              <Info className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">
                Qeydiyyat axını tezliklə
              </p>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Xidmət → mütəxəssis → tarix → vaxt → təsdiq axını növbəti addımda
                qurulacaq. Mövcud vaxtlar üçün API hazırdır:
              </p>
              <code className="mt-2 inline-block rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">
                /api/public/{slug}/availability
              </code>
            </div>
          </div>
        </div>

        <p className="mt-10 flex items-center justify-center gap-1.5 text-center text-sm text-faint-foreground">
          <MapPin className="h-3.5 w-3.5" strokeWidth={2} />
          SalonBook.az ilə gücləndirilib
        </p>
      </main>
    </div>
  );
}

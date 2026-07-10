import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { bakuToday, shiftYmd, formatBakuDateTime } from "@/lib/time";
import { Logo } from "@/components/site-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { ManageWidget } from "./manage-widget";

export const dynamic = "force-dynamic";

// Public self-service page for one appointment, addressed by its manageToken
// (shown to the customer right after booking). View, cancel or reschedule —
// no account needed; the unguessable token is the authorization.

export default async function ManageAppointmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) notFound();

  const appt = await prisma.appointment.findUnique({
    where: { manageToken: token },
    select: {
      status: true,
      startsAt: true,
      priceMinor: true,
      salon: { select: { name: true, slug: true } },
      service: { select: { name: true, durationMin: true } },
      employee: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
  if (!appt) notFound();

  // Next 14 Baku days for the reschedule picker (same as the booking widget).
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

  const upcoming = appt.startsAt > new Date();

  return (
    <div className="relative min-h-screen">
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[360px] glow-accent opacity-70" />

      <header className="border-b border-border">
        <div className="mx-auto flex h-16 max-w-xl items-center justify-between px-6">
          <Logo />
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-xl px-6 py-10">
        <ManageWidget
          token={token}
          salonName={appt.salon.name}
          salonSlug={appt.salon.slug}
          customerName={appt.customer.name}
          service={appt.service.name}
          durationMin={appt.service.durationMin}
          employee={appt.employee.name}
          whenLabel={formatBakuDateTime(appt.startsAt)}
          priceMinor={appt.priceMinor}
          status={appt.status}
          upcoming={upcoming}
          days={days}
        />
      </main>
    </div>
  );
}

import { getLocale, getTranslations } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { getClientSession } from "@/lib/auth/client-session";
import { prisma } from "@/lib/prisma";
import { formatBakuDateTime } from "@/lib/time";
import { HistoryList, type Visit } from "./history-list";

export const dynamic = "force-dynamic";

const azn = (m: number) => {
  const v = m / 100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
};

// Client visit history. Gated on the client session; scoped to the session's
// VERIFIED phone (never a request value) — a client can only see their own
// visits across all salons.
export default async function HistoryPage() {
  const session = await getClientSession();
  const locale = await getLocale();
  if (!session) {
    redirect({ href: "/profile/sign-in", locale });
    return null; // unreachable — redirect() throws
  }
  const t = await getTranslations("History");

  const appts = await prisma.appointment.findMany({
    where: { customer: { phone: session.phone } },
    orderBy: { startsAt: "desc" },
    take: 100,
    select: {
      id: true,
      startsAt: true,
      status: true,
      priceMinor: true,
      serviceId: true,
      employeeId: true,
      salon: { select: { name: true, slug: true } },
      employee: { select: { name: true } },
      service: { select: { name: true } },
      review: { select: { id: true } },
    },
  });

  const visits: Visit[] = appts.map((a) => ({
    id: a.id,
    salonName: a.salon.name,
    salonSlug: a.salon.slug,
    employeeName: a.employee.name,
    serviceName: a.service.name,
    serviceId: a.serviceId,
    employeeId: a.employeeId,
    when: formatBakuDateTime(a.startsAt, locale),
    price: `${azn(a.priceMinor)} ₼`,
    status: a.status as Visit["status"],
    canReview: a.status === "COMPLETED" && !a.review,
  }));

  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
      {visits.length === 0 ? (
        <p className="mt-6 text-sm text-faint-foreground">{t("empty")}</p>
      ) : (
        <HistoryList visits={visits} />
      )}
    </main>
  );
}

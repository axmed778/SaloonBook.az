import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

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
    <main className="mx-auto max-w-2xl px-6 py-12">
      <h1 className="text-3xl font-bold">{salon.name}</h1>
      {salon.description && <p className="mt-2 text-neutral-500">{salon.description}</p>}

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Xidmətlər
        </h2>
        <ul className="mt-3 divide-y divide-neutral-200 dark:divide-neutral-800">
          {salon.services.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-3">
              <span>
                {s.name}
                <span className="ml-2 text-sm text-neutral-400">{s.durationMin} dəq</span>
              </span>
              <span className="font-medium">{(s.priceMinor / 100).toFixed(2)} ₼</span>
            </li>
          ))}
          {salon.services.length === 0 && (
            <li className="py-3 text-neutral-400">Xidmət əlavə edilməyib.</li>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Mütəxəssislər
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {salon.employees.map((e) => (
            <li
              key={e.id}
              className="rounded-full border border-neutral-300 px-3 py-1 text-sm dark:border-neutral-700"
            >
              {e.name}
              {e.position && <span className="text-neutral-400"> · {e.position}</span>}
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-10 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-500 dark:bg-neutral-900">
        Qeydiyyat axını (xidmət → mütəxəssis → tarix → vaxt → təsdiq) növbəti
        addımda qurulacaq. Mövcud vaxtlar üçün API:{" "}
        <code>/api/public/{slug}/availability</code>.
      </p>
    </main>
  );
}

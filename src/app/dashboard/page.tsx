import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // The layout already guarantees a session (redirects otherwise).
  const session = (await getSession())!;
  const greetingName = session.user.fullName?.trim() || session.user.email;

  if (session.isAdmin) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Salam, {greetingName}</h1>
        <p className="mt-2 inline-block rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-700">
          Platform Admin
        </p>
        <p className="mt-6 text-neutral-500">
          Platforma idarəetmə alətləri növbəti addımlarda əlavə olunacaq.
        </p>
      </div>
    );
  }

  // Salon owner view: load their salon + counts, scoped by the session's salonId.
  const salon = session.salonId
    ? await prisma.salon.findUnique({
        where: { id: session.salonId },
        select: {
          name: true,
          slug: true,
          _count: { select: { services: true, employees: true } },
        },
      })
    : null;

  return (
    <div>
      <h1 className="text-2xl font-bold">Salam, {greetingName}</h1>
      <p className="mt-2 inline-block rounded-full bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
        Salon Owner
      </p>

      {salon ? (
        <section className="mt-6 rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="text-lg font-semibold">{salon.name}</h2>
          <p className="mt-1 text-sm text-neutral-500">
            Qeydiyyat səhifəniz:{" "}
            <a href={`/${salon.slug}`} className="font-medium text-emerald-600 hover:underline">
              /{salon.slug}
            </a>
          </p>

          <dl className="mt-5 grid grid-cols-2 gap-4">
            <div className="rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
              <dt className="text-sm text-neutral-500">Xidmətlər</dt>
              <dd className="mt-1 text-2xl font-bold">{salon._count.services}</dd>
            </div>
            <div className="rounded-lg bg-neutral-50 p-4 dark:bg-neutral-900">
              <dt className="text-sm text-neutral-500">İşçilər</dt>
              <dd className="mt-1 text-2xl font-bold">{salon._count.employees}</dd>
            </div>
          </dl>
        </section>
      ) : (
        <p className="mt-6 text-neutral-500">Salon tapılmadı.</p>
      )}
    </div>
  );
}

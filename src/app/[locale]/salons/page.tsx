import type { Metadata } from "next";
import { getTranslations, getLocale } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { Link } from "@/i18n/navigation";
import { DiscoveryMap } from "@/components/discovery-map";

export const dynamic = "force-dynamic";

const appUrl = () => (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
const salonsPath = (loc: string) => (loc === "az" ? "" : `/${loc}`) + "/salons";

// Public, indexable discovery surface. The interactive map is client-side; the
// salon list below is server-rendered for crawlability (salon profile pages at
// /{slug} remain the primary SEO asset, linked from here).
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations("Discovery");
  const base = appUrl();
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: {
      canonical: base + salonsPath(locale),
      languages: {
        az: base + salonsPath("az"),
        en: base + salonsPath("en"),
        ru: base + salonsPath("ru"),
      },
    },
    openGraph: { title: t("metaTitle"), description: t("metaDescription") },
  };
}

export default async function SalonsPage() {
  const t = await getTranslations("Discovery");

  const salons = await prisma.salon.findMany({
    where: { status: "ACTIVE", latitude: { not: null }, longitude: { not: null } },
    orderBy: [{ ratingCount: "desc" }, { createdAt: "asc" }],
    take: 60,
    select: {
      slug: true,
      name: true,
      district: true,
      address: true,
      ratingCount: true,
      ratingSum: true,
    },
  });

  return (
    <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
      </header>

      <DiscoveryMap />

      {salons.length > 0 && (
        <section className="mt-8">
          <h2 className="text-sm font-semibold text-foreground">{t("listTitle")}</h2>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {salons.map((s) => {
              const rating = s.ratingCount > 0 ? s.ratingSum / s.ratingCount : null;
              return (
                <li key={s.slug}>
                  <Link
                    href={`/${s.slug}`}
                    className="block rounded-lg border border-border bg-card p-3 transition hover:bg-hover"
                  >
                    <p className="truncate text-sm font-medium text-foreground">{s.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {s.district || s.address || ""}
                      {rating !== null ? ` · ★ ${rating.toFixed(1)}` : ""}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}

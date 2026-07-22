import type { MetadataRoute } from "next";
import { prisma } from "@/lib/prisma";
import { routing } from "@/i18n/routing";

// Dynamic sitemap: the static marketing/legal pages plus every ACTIVE salon's
// public booking page. Each entry carries hreflang alternates for the three
// locales (az is unprefixed, en/ru are prefixed — see i18n/routing). A salon
// link is a growth loop, so keeping salons in the sitemap helps them get found.
const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

function urlFor(locale: string, path: string): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;
  const suffix = path ? `/${path}` : "";
  return `${appUrl}${prefix}${suffix}` || `${appUrl}/`;
}

function entry(path: string, opts: { changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"]; priority: number; lastModified?: Date }): MetadataRoute.Sitemap[number] {
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[l] = urlFor(l, path);
  return {
    url: urlFor(routing.defaultLocale, path),
    lastModified: opts.lastModified,
    changeFrequency: opts.changeFrequency,
    priority: opts.priority,
    alternates: { languages },
  };
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticEntries: MetadataRoute.Sitemap = [
    entry("", { changeFrequency: "weekly", priority: 1 }),
    entry("privacy", { changeFrequency: "yearly", priority: 0.3 }),
    entry("terms", { changeFrequency: "yearly", priority: 0.3 }),
  ];

  // Never let a DB hiccup 500 the sitemap — fall back to the static pages.
  const salons = await prisma.salon
    .findMany({
      where: { status: "ACTIVE" },
      select: { slug: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    })
    .catch(() => [] as { slug: string; createdAt: Date }[]);

  const salonEntries = salons.map((s) =>
    entry(s.slug, { changeFrequency: "weekly", priority: 0.8, lastModified: s.createdAt }),
  );

  return [...staticEntries, ...salonEntries];
}

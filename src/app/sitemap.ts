import type { MetadataRoute } from "next";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { routing } from "@/i18n/routing";
import { DEMO_SALON_SLUG } from "@/lib/demo";

// Dynamic sitemap: the static marketing/legal pages plus every PUBLISHABLE
// salon's public booking page. Each entry carries hreflang alternates for the
// three locales (az is unprefixed, en/ru are prefixed — see i18n/routing). A
// salon link is a growth loop, so keeping salons in the sitemap helps them get
// found.
//
// Regenerated hourly rather than frozen at build time. Without this the file is
// rendered once during `next build` and never again, so a salon that signs up
// after the deploy stays out of the sitemap until someone happens to redeploy —
// which, on a product whose growth loop IS salon pages getting indexed, is the
// difference between a new customer being findable tomorrow and being findable
// whenever we next ship. An hour is the usual cadence for a sitemap: far below
// how often Google refetches one, and one cached DB query per hour is nothing
// even on a scale-to-zero database.
export const revalidate = 3600;

const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * "Should this salon appear on a PUBLIC, crawlable surface?" — the single
 * definition, so the sitemap and the public catalogue/map cannot drift apart
 * and start advertising salons the other one hides.
 *
 * Four conditions, each for its own reason:
 *   - status ACTIVE — a SUSPENDED or DELETED salon is not open for business.
 *   - not the demo salon — it is ACTIVE because the landing page links to it,
 *     but it is a marketing prop, and indexing it puts a fake salon in
 *     competition with real ones for the same queries (see lib/demo.ts).
 *   - the owning Account is ACTIVE — a suspended account's owner cannot log in,
 *     so nobody is there to answer a booking. Its salons must vanish from
 *     public surfaces at the same moment, not linger in Google's index taking
 *     bookings that will never be honoured.
 *   - at least one active service AND one active employee — a salon with
 *     neither is a half-finished signup, not a listing. Its booking page has
 *     nothing to book, so indexing it earns the domain a thin/empty-content
 *     page and the visitor a dead end.
 */
export const publishableSalonWhere: Prisma.SalonWhereInput = {
  status: "ACTIVE",
  slug: { not: DEMO_SALON_SLUG },
  account: { is: { status: "ACTIVE" } },
  services: { some: { isActive: true } },
  employees: { some: { isActive: true } },
};

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

  let salons: { slug: string; createdAt: Date }[];
  try {
    salons = await prisma.salon.findMany({
      where: publishableSalonWhere,
      select: { slug: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });
  } catch (err) {
    // Deliberately NOT swallowed. Serving the static pages on a DB failure looks
    // like a graceful degradation and is the opposite: an empty sitemap is a
    // positive assertion to Google that the site has no salon pages, and the
    // cached copy of that lie then sticks around for the revalidate window.
    // Throwing means the crawler gets a 500, retries later, and keeps the
    // sitemap it already has.
    //
    // The one exception is the build itself: `next build` prerenders this route,
    // but migrations run in the deploy step AFTER the build, so the builder may
    // legitimately have no reachable database. Failing there would turn a
    // sitemap problem into a failed deploy, and the prerendered copy is replaced
    // by the first revalidation anyway.
    if (process.env.NEXT_PHASE === "phase-production-build") {
      console.error("[sitemap] database unreachable at build time — emitting static pages only:", err);
      return staticEntries;
    }
    throw err;
  }

  const salonEntries = salons.map((s) =>
    entry(s.slug, { changeFrequency: "weekly", priority: 0.8, lastModified: s.createdAt }),
  );

  return [...staticEntries, ...salonEntries];
}

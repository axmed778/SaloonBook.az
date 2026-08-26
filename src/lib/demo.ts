// The public demo salon.
//
// /demostudio is a marketing surface, not a customer: the landing page links to
// it from three CTAs, the footer lists it under "demo", and the 404 page offers
// it as a way out. It must therefore stay ACTIVE and reachable — it is not a
// leftover test record, even though prisma/seed.ts creates it.
//
// What it should NOT be is a search result. Indexing it puts a fake salon in
// competition with real ones for the same queries, so it is excluded from the
// sitemap and served with robots: noindex — reachable for humans, invisible to
// crawlers. That is a metadata concern, not a status concern; suspending the
// salon would take the demo offline instead.
export const DEMO_SALON_SLUG = "demostudio";

export function isDemoSalon(slug: string): boolean {
  return slug === DEMO_SALON_SLUG;
}

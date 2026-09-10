// Free-text filtering for the admin account table, kept out of the component so
// it can be tested without rendering one. Runs in the browser for the same
// reason the sorting does (see admin-sort.ts): the page already holds every
// account, so filtering is an array pass, not a round trip.

export type SearchableRow = {
  salonName: string;
  accountName: string;
  slug: string | null;
  ownerEmail: string;
};

/** Nonspacing combining marks — what NFD leaves behind once it splits ö into o + ̈ . */
const COMBINING_MARKS = /\p{Mn}/gu;

/**
 * Casefold a string down to something an admin can type on any keyboard.
 *
 * Two steps, because Azerbaijani needs both. Decomposing strips the marks that
 * ARE marks (ö→o, ü→u, ç→c, ş→s, ğ→g). The explicit pairs handle the letters
 * that are not: ə and ı are distinct letters with no ASCII decomposition, so
 * "gozellik" would never reach "Gözəllik" without them.
 */
export function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/ə/g, "e")
    .replace(/ı/g, "i");
}

/**
 * Split a query into terms. Every term has to match somewhere in the row, in
 * any order, so "demo studio" finds "Demo Beauty Studio" — which is how people
 * type a half-remembered name.
 */
export function queryTerms(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

function haystack(row: SearchableRow): string {
  return fold([row.salonName, row.accountName, row.slug ?? "", row.ownerEmail].join(" "));
}

export function matchesTerms(row: SearchableRow, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const hay = haystack(row);
  return terms.every((term) => hay.includes(term));
}

/** Rows matching every term in `query`; the whole list when it is blank. */
export function filterRows<T extends SearchableRow>(rows: readonly T[], query: string): T[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [...rows];
  return rows.filter((row) => matchesTerms(row, terms));
}

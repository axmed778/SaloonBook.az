// Parsing user-entered AZN amounts.
//
// Azerbaijani keyboards and locales use a comma as the decimal separator, so
// "12,50" is what a salon owner actually types. parseFloat("12,50") returns 12
// — it stops at the comma and reports success — so a price silently loses its
// qəpik. Every service priced with a comma was being stored 50 qəpik light, on
// every booking, with nothing anywhere to show for it.
//
// Both accessors share one parser so a form can never disagree with another
// form about what "12,50" means.

/** Parse an AZN amount ("450" / "450.50" / "450,50") into AZN, or null. */
export function parseAznAmount(input: string): number | null {
  const raw = input.trim().replace(",", ".");
  if (raw === "") return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

/** Parse an AZN amount into qəpik (minor units), or null. */
export function parseAznToMinor(input: string): number | null {
  const v = parseAznAmount(input);
  return v === null ? null : Math.round(v * 100);
}

// Searching the help panel's tasks: the person's words against each guide's
// title (in the UI's language) and its synonyms (all three languages).
// Entirely local — no service, no network. PURE, tested as a table of queries
// (search.test.ts).
//
// Matching, loosest that stays useful:
//   - lower case, and letters folded to plain Latin/Cyrillic: ə→e, ı→i, ş→s,
//     ç→c, ğ→g, ö→o, ü→u, ё→е — "mezuniyyet" finds "məzuniyyət";
//   - a query word matches an index word it begins (from 2 letters: "отп" →
//     "отпуск"), or — for words of 5+ letters — one typo away ("otpsk");
//   - each matched query word scores 1 / (how many tasks it matches), so the
//     telling word outweighs the common one; ties keep registry order.

import { GUIDE_SYNONYMS } from "./synonyms";
import type { GuideId } from "./registry";

const FOLD: Record<string, string> = {
  ə: "e", ı: "i", ş: "s", ç: "c", ğ: "g", ö: "o", ü: "u", ё: "е",
};

export function normalize(text: string): string {
  return text
    .toLocaleLowerCase("tr") // Azerbaijani/Turkish I: "İ" → "i", "I" → "ı" (folded below)
    .normalize("NFC")
    .replace(/[əışçğöüё]/g, (ch) => FOLD[ch] ?? ch)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // any leftover accent (e.g. "i̇")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

/** At most one edit (insert, delete, substitute) apart. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function wordMatches(query: string, indexWord: string): boolean {
  if (query.length >= 2 && indexWord.startsWith(query)) return true;
  if (query.length >= 5) {
    if (withinOneEdit(query, indexWord)) return true;
    // A typo in a word typed only partly: compare with the same-length start.
    if (indexWord.length > query.length && withinOneEdit(query, indexWord.slice(0, query.length))) return true;
  }
  return false;
}

export interface Searchable {
  id: GuideId;
  /** The guide's title in the UI's language. */
  title: string;
}

/**
 * The guides that match, best first. An empty query matches nothing (the panel
 * shows the full list then). Only the guides passed in can come out — the
 * caller passes the list the server allowed.
 */
export function searchGuides<T extends Searchable>(query: string, guides: readonly T[]): T[] {
  const q = words(query);
  if (q.length === 0) return [];
  const indexes = guides.map((g) => [...new Set([...words(g.title), ...GUIDE_SYNONYMS[g.id].flatMap(words)])]);
  // Which guides each query word matches.
  const hits = q.map((w) => indexes.map((index) => index.some((iw) => wordMatches(w, iw))));
  return guides
    .map((g, i) => {
      // A word that fits one task says more than one that fits five ("больничный"
      // vs "мастера"): each matched word counts 1 / (tasks it matches).
      const score = hits.reduce((sum, row) => {
        if (!row[i]) return sum;
        return sum + 1 / row.filter(Boolean).length;
      }, 0);
      return { g, score, order: i };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map((r) => r.g);
}

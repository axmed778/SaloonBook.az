// Contact detection and redaction for free-text booking notes.
//
// The note on a booking is the customer's own prose ("tünd çalar, allergiya
// var"). It is genuinely useful to the master doing the work, so it is shown to
// them — but customers do write "zəng edin 050 123 45 67" into it, and a
// master's dashboard is precisely where a phone number must not appear.
//
// So the note reaches a master redacted, on the SERVER, in the serializer. Not
// in a component: a client-side mask would still ship the original text in the
// RSC payload, which is readable with View Source.
//
// Two rules, two passes, because they need opposite normalizations:
//
//   * PHONES are written with separators on purpose — "050-123-45-67",
//     "+994 (50) 123 45 67", or with zero-width characters pasted in between.
//     They are found on a copy with spaces, dots, hyphens (ASCII and Unicode),
//     brackets and invisible characters removed.
//   * EMAILS, @handles and wa.me/t.me links NEED their dots and hyphens to be
//     recognisable at all, so they are matched on the original text (minus
//     invisible characters only).
//
// Both passes record ranges in ORIGINAL coordinates, which is why each
// normalization carries a map back to the source index. The ranges are then
// merged and cut, so the untouched parts of the note survive verbatim.
//
// Deliberately NOT matched (each has a test): clock times ("18:30"), durations
// ("2 saat"), ordinals ("3-cü mərtəbə"), percentages ("15%") and prices. The
// threshold is seven digits, which no such value reaches.
//
// Pure: no imports, no I/O, no framework. hasContact() and redactContacts()
// share one range finder, so the validator that rejects a note and the redactor
// that cleans an old one can never disagree about what a contact is.

/** What a redacted span is replaced with. "gizli" = hidden (az). */
export const REDACTION = "[gizli]";

// Characters dropped before looking for phone numbers: whitespace (\s already
// covers NBSP, thin space and the BOM), the separators people put inside a
// number, every Unicode dash, and the invisible characters used to break up a
// string that a naive filter would otherwise catch.
//
// Commas are deliberately NOT dropped: "10, 20, 30, 40" would otherwise join
// into an eight-digit run and be redacted as a phone number.
const PHONE_NOISE =
  // ASCII: whitespace, full stop, brackets, hyphen-minus.
  // \u00AD soft hyphen; \u058A \u05BE \u1806 \u2010-\u2015 \u2043 \u2212 \uFE58 \uFE63
  // \uFF0D: every other dash a keyboard or a paste can produce.
  // \u200B-\u200F \u2060 \u180E: zero-width and bidi marks (pure evasion).
  /[\s.()[\]{}\u002D\u00AD\u058A\u05BE\u1806\u2010-\u2015\u2043\u2212\uFE58\uFE63\uFF0D\u200B-\u200F\u2060\u180E]/;

// Invisible characters only. Everything visible — dots and hyphens included —
// survives, because an email or a link is nothing without them.
const INVISIBLE = /[\u00AD\u200B-\u200F\u2060\u180E\uFEFF]/;

/**
 * Any run of seven or more digits, once the separators are gone. This is the
 * rule that catches "050 123 45 67", "0501234567" and "050-123-45-67" alike.
 * Seven is the floor because it is the shortest thing anyone dials, and it sits
 * well above every innocent number a service note contains.
 */
const DIGIT_RUN = /\d{7,}/g;

/**
 * A number that announces itself by prefix even when it is too short (or too
 * mangled) for the run rule: the country code, or a mobile operator code. A
 * truncated number is still an attempt to pass a contact, and still enough for
 * someone to guess the rest.
 */
const PREFIXED_NUMBER = /(?:\+?994|0(?:10|12|50|51|55|60|70|77|99))\d{3,}/g;

/**
 * A calendar date, which a service note has every right to contain:
 * "07.09.2026", "7/9/26", "07-09-26". Its digits are excluded from the run
 * count below, or "07.09.2026" would normalize to the eight-digit 07092026 and
 * be cut as a phone number.
 *
 * The separator is captured and back-referenced, so both separators inside one
 * date must be the same character: "07.09-2026" is not a date and stays a
 * candidate for redaction. Neither pattern carries a lookbehind — this module
 * also runs in the browser, and lookbehind is a parse-time syntax error on
 * older Safari, which would take the whole booking form down. The left/right
 * boundary is enforced in code instead, by isGluedToDigits().
 */
const DMY_DATE = /(\d{1,2})([./-])(\d{1,2})\2(?:\d{4}|\d{2})/g;

/** The ISO form, "2026-09-07". */
const ISO_DATE = /\d{4}-\d{1,2}-\d{1,2}/g;

/** Email addresses. Matched on visible text — the dots are the point. */
const EMAIL = /[\p{L}\p{N}][\p{L}\p{N}._%+-]*@[\p{L}\p{N}][\p{L}\p{N}.-]*\.\p{L}{2,}/gu;

/**
 * Instagram/Telegram handles. Two characters minimum after the "@" so a stray
 * "@" or a price like "2@" is left alone. An address like ali@mail.ru matches
 * this too, from the "@" on — the ranges are merged, so the whole email goes.
 */
const HANDLE = /@[\p{L}\p{N}_][\p{L}\p{N}._]{1,29}/gu;

/** Direct-message links. The path is swallowed with them (it is the number). */
const MESSENGER_LINK =
  /(?:https?:\/\/)?(?:www\.)?(?:wa\.me|t\.me|api\.whatsapp\.com)(?:\/[\p{L}\p{N}_\-./?=&%+]*)?/giu;

/** A half-open [start, end) slice of the ORIGINAL string. */
interface Range {
  start: number;
  end: number;
}

interface Normalized {
  /** The source with the dropped characters removed. */
  text: string;
  /** map[i] = index in the source of text[i]. */
  map: number[];
}

/**
 * Stands in for a character inside a protected range. Not a digit and not
 * noise, so it breaks a digit run rather than joining one — and it occupies
 * exactly one slot, which keeps the index map aligned with the source.
 */
const MASK = "\u0000";

/**
 * Drops every character matching `noise`, remembering where the survivors came
 * from. Iterated per code unit rather than per code point so the map indices
 * stay usable for slicing — a surrogate pair is never noise, so both halves are
 * kept and mapped in order.
 *
 * Characters inside `protect` are replaced by MASK instead of being dropped, so
 * the digits of a date take no part in the phone rules: they neither form a run
 * of their own nor glue the runs on either side of them together.
 */
function normalize(source: string, noise: RegExp, protect: Range[] = []): Normalized {
  let text = "";
  const map: number[] = [];
  let p = 0;
  for (let i = 0; i < source.length; i++) {
    while (p < protect.length && protect[p].end <= i) p++;
    const masked = p < protect.length && i >= protect[p].start;
    const ch = source[i];
    if (!masked && noise.test(ch)) continue;
    text += masked ? MASK : ch;
    map.push(i);
  }
  return { text, map };
}

/** Every match of `re` in a normalized string, translated back to the source. */
function rangesIn(norm: Normalized, re: RegExp): Range[] {
  const out: Range[] = [];
  // Fresh regex per call: the module-level ones carry /g and therefore lastIndex.
  const rx = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = rx.exec(norm.text)) !== null) {
    if (m[0].length === 0) {
      rx.lastIndex++;
      continue;
    }
    const first = norm.map[m.index];
    const last = norm.map[m.index + m[0].length - 1];
    // The separators that sat INSIDE the match fall between these two source
    // indices, so they are cut with it — "050 123 45 67" goes as one span.
    out.push({ start: first, end: last + 1 });
  }
  return out;
}

/**
 * Is this span glued to more digits — i.e. is the nearest character on either
 * side, ignoring the separators a number is written with, itself a digit?
 *
 * This is what keeps the date exception from becoming the way around the whole
 * rule. Two things would otherwise slip through:
 *
 *   * a date pattern matched INSIDE a phone number — "0501.23.4567" contains
 *     "1.23.4567", and protecting that would leave a harmless "050" behind;
 *   * a number DRESSED as a date — "05.01.2345 67" is not a date anybody means,
 *     it is ten digits with a plausible mask on the first eight.
 *
 * In both, the span has a digit pressed up against it. A date a human actually
 * wrote is followed by a space and a word, or by a comma, or by nothing.
 */
function isGluedToDigits(text: string, r: Range): boolean {
  let i = r.start - 1;
  while (i >= 0 && PHONE_NOISE.test(text[i])) i--;
  if (i >= 0 && /\d/.test(text[i])) return true;
  let j = r.end;
  while (j < text.length && PHONE_NOISE.test(text[j])) j++;
  return j < text.length && /\d/.test(text[j]);
}

/**
 * The date spans whose digits must be kept out of the phone rules. A match that
 * is glued to further digits is NOT one — see isGluedToDigits().
 */
function protectedDateRanges(text: string): Range[] {
  const whole: Normalized = { text, map: text.split("").map((_, i) => i) };
  return merge(
    [...rangesIn(whole, DMY_DATE), ...rangesIn(whole, ISO_DATE)].filter(
      (r) => !isGluedToDigits(text, r),
    ),
  );
}

/**
 * Brackets that directly abut a redacted number belong to it: "(050) 123 45 67"
 * matches from the first digit, which would leave a forlorn "(" behind. Only
 * brackets are swallowed — extending over spaces would eat the word before the
 * number, and over dots the end of the previous sentence.
 */
const BRACKET = /[()[\]{}]/;

function expandOverBrackets(text: string, r: Range): Range {
  let { start, end } = r;
  while (start > 0 && BRACKET.test(text[start - 1])) start--;
  while (end < text.length && BRACKET.test(text[end])) end++;
  return { start, end };
}

/** Sorted, non-overlapping union of the ranges. */
function merge(ranges: Range[]): Range[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Range[] = [{ ...sorted[0] }];
  for (const r of sorted.slice(1)) {
    const last = out[out.length - 1];
    if (r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/**
 * Every span of `text` that looks like a way to reach the customer directly.
 * The one definition of "a contact", shared by the validator and the redactor.
 */
export function findContactRanges(text: string): Range[] {
  if (!text) return [];
  // Dates first, on the RAW text: a date laced with zero-width characters is
  // not a date anyone typed, so it earns no protection.
  const dates = protectedDateRanges(text);
  const forPhones = normalize(text, PHONE_NOISE, dates);
  const forLinks = normalize(text, INVISIBLE);
  const phones = [
    ...rangesIn(forPhones, DIGIT_RUN),
    ...rangesIn(forPhones, PREFIXED_NUMBER),
  ].map((r) => expandOverBrackets(text, r));
  return merge([
    ...phones,
    ...rangesIn(forLinks, EMAIL),
    ...rangesIn(forLinks, HANDLE),
    ...rangesIn(forLinks, MESSENGER_LINK),
  ]);
}

/**
 * True when the text contains a phone number, email, handle or messenger link.
 *
 * Used by the booking endpoints to REFUSE such a note at the source, so the
 * customer is told to write their wish in words instead of quietly having it
 * mangled. Redaction stays in place behind it for notes written before this
 * rule existed, and for anything that gets past it.
 */
export function hasContact(text: string | null | undefined): boolean {
  return typeof text === "string" && findContactRanges(text).length > 0;
}

/**
 * The text with every contact replaced by [gizli]. Returns the input unchanged
 * when there is nothing to redact, so an ordinary note is never reformatted.
 */
export function redactContacts(text: string): string {
  const ranges = findContactRanges(text);
  if (ranges.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const r of ranges) {
    out += text.slice(cursor, r.start) + REDACTION;
    cursor = r.end;
  }
  return out + text.slice(cursor);
}

/** redactContacts() for a nullable column — null and "" pass straight through. */
export function redactContactsOrNull(text: string | null | undefined): string | null {
  if (typeof text !== "string" || text === "") return text ?? null;
  return redactContacts(text);
}

// Safe embedding of JSON-LD structured data into an inline <script> tag.
//
// JSON.stringify does NOT escape "<", ">" or "&", so any string it serializes can
// close the surrounding element. Salon name/description/address are free-form
// owner input (see dashboard/settings/actions.ts profileSchema - only length is
// capped) and land in the LocalBusiness payload on the public booking page, so a
// salon named `</script><script>...` would otherwise execute as script for every
// visitor of that page. The CSP allows 'unsafe-inline' for script-src
// (next.config.ts), so the browser would happily run it.
//
// Escaping those characters as \uXXXX keeps the JSON semantically identical -
// every JSON parser decodes the escapes back - while making the payload inert
// inside HTML.

// Characters that can break out of an inline <script> or a JS string literal.
// Built from char codes so the two line separators (U+2028/U+2029) stay visible
// in this source instead of being invisible bytes. They are valid inside JSON
// and harmless in an application/ld+json block, but are line terminators in JS,
// so escaping them keeps this helper safe to reuse for any JSON in a page.
const SCRIPT_UNSAFE = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");

/**
 * Serialize `data` for `dangerouslySetInnerHTML` inside a
 * `<script type="application/ld+json">` tag. Use this instead of a bare
 * JSON.stringify whenever any part of the payload can come from user input.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    SCRIPT_UNSAFE,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

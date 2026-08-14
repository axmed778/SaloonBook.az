import { describe, it, expect } from "vitest";
import { serializeJsonLd } from "./json-ld";

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);

describe("serializeJsonLd", () => {
  it("neutralizes a </script> breakout in salon-controlled text", () => {
    // The real attack: a salon owner sets this as their salon name in Settings,
    // and it lands in the LocalBusiness JSON-LD on their public booking page.
    const payload = {
      "@type": "HealthAndBeautyBusiness",
      name: "</script><script>alert(document.cookie)</script>",
    };
    const out = serializeJsonLd(payload);
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).toContain("\\u003c");
  });

  it("escapes every character that can break out of an inline script", () => {
    const out = serializeJsonLd({ s: `<>&${LS}${PS}` });
    for (const c of ["<", ">", "&", LS, PS]) {
      expect(out).not.toContain(c);
    }
    expect(out).toContain("\\u003c\\u003e\\u0026\\u2028\\u2029");
  });

  it("keeps the JSON semantically identical (escapes decode back)", () => {
    const payload = {
      name: "Nərgiz <Beauty> & Spa",
      description: `çox\ngözəl ${LS} salon`,
      priceRange: "5–40 AZN",
      nested: { a: [1, 2, "</script>"] },
    };
    expect(JSON.parse(serializeJsonLd(payload))).toEqual(payload);
  });

  it("leaves payloads without unsafe characters byte-identical to JSON.stringify", () => {
    const payload = { "@context": "https://schema.org", name: "Nərgiz Beauty", areaServed: "AZ" };
    expect(serializeJsonLd(payload)).toBe(JSON.stringify(payload));
  });
});

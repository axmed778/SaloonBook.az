import { describe, it, expect } from "vitest";
import { fold, filterRows, queryTerms, type SearchableRow } from "./admin-search";

// The search box exists so an admin on the phone with a salon can find that
// salon while they are still talking. Most of these cases are about typing it
// wrong and still landing on it.

function row(partial: Partial<SearchableRow> & { salonName: string }): SearchableRow {
  return {
    accountName: partial.salonName,
    slug: partial.salonName.toLowerCase().replace(/\s+/g, ""),
    ownerEmail: "owner@example.com",
    ...partial,
  };
}

const ROWS: SearchableRow[] = [
  row({ salonName: "Gözəllik Studiyası", slug: "mysalon", ownerEmail: "leyla@salon.az" }),
  row({ salonName: "Demo Beauty Studio", slug: "demostudio", ownerEmail: "demo@book.az" }),
  row({ salonName: "Şəfa Klinika", slug: "shefa", ownerEmail: "info@shefa.az" }),
];

const found = (query: string) => filterRows(ROWS, query).map((r) => r.salonName);

describe("fold", () => {
  it("strips the marks that are marks", () => {
    expect(fold("Gözəllik")).toBe("gozellik");
    expect(fold("Şəfa")).toBe("sefa");
    expect(fold("ÇİÇƏK")).toBe("cicek");
  });

  it("handles the Azerbaijani letters that do not decompose", () => {
    // ə and ı are letters in their own right, not accented vowels — without an
    // explicit pairing a Latin-keyboard search would never reach them.
    expect(fold("ə")).toBe("e");
    expect(fold("ı")).toBe("i");
    expect(fold("Ə")).toBe("e");
  });
});

describe("queryTerms", () => {
  it("splits on whitespace and drops the empties", () => {
    expect(queryTerms("  demo   studio ")).toEqual(["demo", "studio"]);
    expect(queryTerms("   ")).toEqual([]);
  });
});

describe("filterRows", () => {
  it("returns everything for a blank query", () => {
    expect(filterRows(ROWS, "").length).toBe(3);
    expect(filterRows(ROWS, "   ").length).toBe(3);
  });

  it("finds a salon typed on a Latin keyboard, without the diacritics", () => {
    expect(found("gozellik")).toEqual(["Gözəllik Studiyası"]);
    expect(found("sefa")).toEqual(["Şəfa Klinika"]);
  });

  it("matches terms in any order, so a half-remembered name still lands", () => {
    expect(found("studio demo")).toEqual(["Demo Beauty Studio"]);
    expect(found("demo studio")).toEqual(["Demo Beauty Studio"]);
  });

  it("searches the slug and the owner e-mail too", () => {
    expect(found("mysalon")).toEqual(["Gözəllik Studiyası"]);
    expect(found("leyla@salon.az")).toEqual(["Gözəllik Studiyası"]);
    expect(found("@book.az")).toEqual(["Demo Beauty Studio"]);
  });

  it("ignores case", () => {
    expect(found("DEMO")).toEqual(["Demo Beauty Studio"]);
  });

  it("requires every term, so a wrong one narrows to nothing", () => {
    expect(found("demo klinika")).toEqual([]);
  });

  it("returns an empty list rather than everything when nothing matches", () => {
    expect(found("zzzz")).toEqual([]);
  });

  it("does not mutate the array it was given", () => {
    const before = ROWS.map((r) => r.salonName);
    filterRows(ROWS, "demo");
    expect(ROWS.map((r) => r.salonName)).toEqual(before);
  });
});

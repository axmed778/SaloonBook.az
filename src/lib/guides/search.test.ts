import { describe, it, expect } from "vitest";
import az from "../../../messages/az.json";
import ru from "../../../messages/ru.json";
import en from "../../../messages/en.json";
import { normalize, searchGuides } from "./search";
import { GUIDE_SYNONYMS } from "./synonyms";
import { GUIDES, type GuideId } from "./registry";

// What people type, and the task they should get first. The index is built
// from the titles in one UI language plus the synonyms in all three, so each
// table runs against every UI language.

const ALL = GUIDES.map((g) => g.id as GuideId);
// What an owner is offered: everything but reception's own time-off guide
// (hideWith), which shares its words with theirs.
const OWNER = ALL.filter((id) => id !== "timeOffReception");
const catalogs = { az, ru, en } as Record<string, { Guides: { guides: Record<string, { title: string }> } }>;
const listIn = (locale: string, ids: readonly GuideId[] = OWNER) =>
  ids.map((id) => ({ id, title: catalogs[locale]!.Guides.guides[id]!.title }));

const FIRST: [string, GuideId][] = [
  // Russian
  ["отпуск", "timeOff"],
  ["отп", "timeOff"],
  ["больничный мастера", "timeOff"],
  ["пароль мастеру", "masterLogin"],
  ["логин", "masterLogin"],
  ["обед", "lunchBreak"],
  ["перерыв", "lunchBreak"],
  ["оплатить тариф", "payPlan"],
  ["доп к услуге", "addAddon"],
  ["часы работы", "workingHours"],
  ["ссылка в инстаграм", "bookingLink"],
  ["записать клиента", "manualBooking"],
  ["адрес салона", "salonProfile"],
  // Azerbaijani, with and without the letters
  ["məzuniyyət", "timeOff"],
  ["mezuniyyet", "timeOff"],
  ["şifrə", "masterLogin"],
  ["sifre", "masterLogin"],
  ["ödəniş", "payPlan"],
  ["odenis", "payPlan"],
  ["nahar fasiləsi", "lunchBreak"],
  ["İŞÇİ", "addWorker"],
  // English
  ["pay", "payPlan"],
  ["vacation", "timeOff"],
  ["password", "masterLogin"],
  ["lunch", "lunchBreak"],
  ["add-on", "addAddon"],
  // Latin spelling of Russian, and a typo
  ["otpusk", "timeOff"],
  ["parol", "masterLogin"],
  ["otpsk", "timeOff"],
  ["расписане", "workingHours"],
];

describe("task search", () => {
  for (const locale of Object.keys(catalogs)) {
    it(`finds the right task first — ${locale} UI`, () => {
      for (const [query, want] of FIRST) {
        expect(searchGuides(query, listIn(locale))[0]?.id, `"${query}"`).toBe(want);
      }
    });
  }

  it("finds by the title in the UI's language", () => {
    expect(searchGuides("Nahar", listIn("az"))[0]?.id).toBe("lunchBreak");
    expect(searchGuides("staff member", listIn("en")).map((g) => g.id)).toContain("addWorker");
  });

  it("returns only guides it was given (the server's list)", () => {
    const receptionList = listIn("ru", ["manualBooking", "timeOffReception"]);
    expect(searchGuides("пароль", receptionList)).toEqual([]);
    expect(searchGuides("отпуск", receptionList).map((g) => g.id)).toEqual(["timeOffReception"]);
  });

  it("matches nothing for an empty query or noise", () => {
    expect(searchGuides("", listIn("ru"))).toEqual([]);
    expect(searchGuides("  ,. ", listIn("ru"))).toEqual([]);
    expect(searchGuides("zzzzqqq", listIn("ru"))).toEqual([]);
    // One letter is too little to match on.
    expect(searchGuides("о", listIn("ru"))).toEqual([]);
  });

  it("folds letters so the keyboard layout does not matter", () => {
    expect(normalize("Məzuniyyət")).toBe("mezuniyyet");
    expect(normalize("İŞÇİ")).toBe("isci");
    expect(normalize("Ёлка")).toBe("елка");
    expect(normalize("Add-on!")).toBe("add on");
  });

  it("has synonyms for every guide", () => {
    for (const id of ALL) expect(GUIDE_SYNONYMS[id].length, id).toBeGreaterThan(3);
  });
});

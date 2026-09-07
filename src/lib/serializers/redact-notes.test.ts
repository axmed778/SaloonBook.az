import { describe, it, expect } from "vitest";
import {
  REDACTION,
  findContactRanges,
  hasContact,
  redactContacts,
  redactContactsOrNull,
} from "./redact-notes";

// The note field is the customer's own prose, and the master needs to read it.
// These tests pin the line between "a way to reach the customer" (cut) and
// "an ordinary thing people write in a service note" (kept, verbatim).

const noDigitsOf = (s: string, digits: string) => expect(s).not.toContain(digits);

describe("redactContacts — phone numbers", () => {
  const cases: Array<[string, string]> = [
    ["Zəng edin +994 50 123 45 67", "Zəng edin [gizli]"],
    ["Zəng edin 0501234567", "Zəng edin [gizli]"],
    ["050 123 45 67 nömrəsinə yazın", "[gizli] nömrəsinə yazın"],
    ["050-123-45-67", "[gizli]"],
    ["(050) 123 45 67", "[gizli]"],
    ["+994501234567", "[gizli]"],
    ["994 50 123 45 67", "[gizli]"],
    // Unicode dashes and zero-width characters are evasion, not formatting.
    ["050–123–45–67", "[gizli]"],
    ["050​123​45​67", "[gizli]"],
    // Truncated, but still an attempt to pass a number.
    ["050123 nömrə", "[gizli] nömrə"],
    // Two numbers, prose in between, both gone.
    ["0501234567 və ya 0559876543", "[gizli] və ya [gizli]"],
  ];

  it.each(cases)("redacts %j", (input, expected) => {
    expect(redactContacts(input)).toBe(expected);
    expect(hasContact(input)).toBe(true);
  });

  it("leaves no digit of the number behind", () => {
    for (const [input] of cases) {
      const out = redactContacts(input);
      expect(out).not.toMatch(/\d{7,}/);
      noDigitsOf(out.replace(/\D/g, ""), "1234567");
    }
  });
});

describe("redactContacts — emails, handles and messenger links", () => {
  it.each([
    ["Yazın: ali@mail.ru", "Yazın: [gizli]"],
    ["e-mail ali.veliyev+salon@gmail.com sonra", "e-mail [gizli] sonra"],
    ["instagram @salon_baku", "instagram [gizli]"],
    ["telegram: @ali_veliyev", "telegram: [gizli]"],
    ["https://wa.me/994501234567", "[gizli]"],
    ["wa.me/994501234567", "[gizli]"],
    ["t.me/aliveliyev yazın", "[gizli] yazın"],
    ["api.whatsapp.com/send?phone=994501234567", "[gizli]"],
  ])("redacts %j", (input, expected) => {
    expect(redactContacts(input)).toBe(expected);
    expect(hasContact(input)).toBe(true);
  });

  it("swallows the whole address when the handle rule overlaps the email rule", () => {
    // "@mail.ru" matches the handle rule and "ali@mail.ru" the email rule; the
    // merged range must cover the address once, not leave "ali" stranded.
    expect(redactContacts("ali@mail.ru")).toBe(REDACTION);
  });
});

describe("redactContacts — what it must NOT touch", () => {
  it.each([
    "saat 18:30, 2 saat çəkir, 3-cü mərtəbə",
    "tünd çalar, allergiya var",
    "18:30",
    "2 saat",
    "3-cü mərtəbə",
    "15% endirim",
    "qiymət 25 AZN, 25.50 manat",
    "2 nəfər, 3 uşaq",
    "beş yüz on iki nömrəli otaq", // a number in words is not a number
    "saat 9-dan 18-ə qədər",
    "",
  ])("keeps %j verbatim", (input) => {
    expect(redactContacts(input)).toBe(input);
    expect(hasContact(input)).toBe(false);
  });

  it("keeps the surrounding prose when it does cut something", () => {
    expect(redactContacts("Tünd çalar. Zəng edin 0501234567. Təşəkkür!")).toBe(
      "Tünd çalar. Zəng edin [gizli]. Təşəkkür!",
    );
  });
});

describe("redactContacts — dates are not phone numbers", () => {
  it.each([
    "7.09.2026 tarixinə köçürmək olar?",
    "07.09.2026",
    "07/09/2026",
    "07-09-26",
    "2026-09-07",
    "7/9/26 tarixi uyğundur",
    "07.09.2026, saat 18:30",
  ])("keeps %j verbatim", (input) => {
    expect(redactContacts(input)).toBe(input);
    expect(hasContact(input)).toBe(false);
  });

  it("keeps the date and still cuts the number next to it", () => {
    expect(redactContacts("07.09.2026 tarixində, zəng edin 0501234567")).toBe(
      "07.09.2026 tarixində, zəng edin [gizli]",
    );
  });

  it("requires ONE separator throughout — 07.09-2026 is not a date", () => {
    // Eight digits under a mask that no calendar produces. Redacted.
    expect(redactContacts("07.09-2026")).toBe("[gizli]");
  });

  // --- anti-bypass ---------------------------------------------------------
  // The exception must not become the way around the rule: a phone number with
  // dots or dashes in it does not match the date shape, and a date pattern
  // found INSIDE a longer number is rejected for being glued to more digits.
  it.each([
    ["050.123.4567", "[gizli]"],
    ["0501-234-567", "[gizli]"],
    ["0501.23.4567", "[gizli]"],
    ["05.01.2345 67", "[gizli]"],
    ["Zəng edin 050.123.45.67", "Zəng edin [gizli]"],
  ])("still redacts %j", (input, expected) => {
    expect(redactContacts(input)).toBe(expected);
    expect(hasContact(input)).toBe(true);
    expect(redactContacts(input)).not.toMatch(/\d{7,}/);
  });
});

describe("hasContact / findContactRanges", () => {
  it("agrees with redactContacts on every input", () => {
    for (const s of [
      "0501234567",
      "ali@mail.ru",
      "@salon",
      "wa.me/994",
      "saat 18:30",
      "tünd çalar",
      "",
    ]) {
      expect(hasContact(s)).toBe(redactContacts(s) !== s);
    }
  });

  it("is false for null and undefined rather than throwing", () => {
    expect(hasContact(null)).toBe(false);
    expect(hasContact(undefined)).toBe(false);
  });

  it("reports ranges in the ORIGINAL string's coordinates", () => {
    const text = "Zəng: 050 123 45 67 !";
    const [r] = findContactRanges(text);
    expect(text.slice(r.start, r.end)).toBe("050 123 45 67");
  });
});

describe("redactContactsOrNull", () => {
  it("passes null, undefined and empty through untouched", () => {
    expect(redactContactsOrNull(null)).toBeNull();
    expect(redactContactsOrNull(undefined)).toBeNull();
    expect(redactContactsOrNull("")).toBe("");
  });

  it("redacts a real note", () => {
    expect(redactContactsOrNull("zəng 0501234567")).toBe("zəng [gizli]");
  });
});

describe("what the booking endpoints must accept and refuse", () => {
  // The exact rule POST /api/public/[slug]/book (422 NOTE_CONTACT) and the
  // createManualBooking server action apply to the service note. Pinned here so
  // the contract survives a refactor of either endpoint.

  it.each([
    "Zəng edin 0501234567",
    "+994 50 123 45 67",
    "050 123 45 67",
    "050-123-45-67",
    "ali@mail.ru",
    "@salon_baku",
    "wa.me/994501234567",
  ])("refuses %j", (note) => {
    expect(hasContact(note)).toBe(true);
  });

  it.each([
    "tünd çalar",
    "tünd çalar, allergiya var",
    "saat 18:30",
    "saat 18:30, 2 saat çəkir, 3-cü mərtəbə",
    "15% endirim",
    "2 nəfər",
    undefined, // the field is optional
  ])("accepts %j", (note) => {
    expect(hasContact(note)).toBe(false);
  });
});

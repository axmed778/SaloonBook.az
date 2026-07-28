import { describe, it, expect } from "vitest";
import {
  buildWhatsAppLink,
  WA_TEMPLATES,
  type WhatsAppTemplateKey,
} from "./whatsapp-link";

const KEYS: WhatsAppTemplateKey[] = [
  "bookingConfirmed",
  "reminder",
  "rescheduleRequest",
  "reviewRequest",
];

describe("buildWhatsAppLink", () => {
  it("strips every non-digit from the phone (no leading +, spaces, dashes)", () => {
    const url = buildWhatsAppLink("+994 50 123-45-67", "reminder", {});
    expect(url.startsWith("https://wa.me/994501234567?text=")).toBe(true);
    // The digits segment contains only digits.
    const digits = url.slice("https://wa.me/".length, url.indexOf("?"));
    expect(digits).toBe("994501234567");
    expect(digits).not.toContain("+");
  });

  it("URL-encodes the prefilled message (no raw spaces or newlines)", () => {
    const url = buildWhatsAppLink("994501234567", "reviewRequest", { salon: "Nərgiz Beauty" });
    const text = url.split("?text=")[1];
    expect(text).toBeTruthy();
    expect(text).not.toContain(" ");
    // Round-trips back to a non-empty human string containing the salon name.
    const decoded = decodeURIComponent(text);
    expect(decoded).toContain("Nərgiz Beauty");
  });

  it("interpolates vars into the chosen template", () => {
    const url = buildWhatsAppLink("994501234567", "bookingConfirmed", {
      client: "Aygün",
      salon: "Nərgiz",
      service: "Saç kəsimi",
      when: "22 iyul, 14:30",
    });
    const decoded = decodeURIComponent(url.split("?text=")[1]);
    expect(decoded).toContain("Aygün");
    expect(decoded).toContain("Nərgiz");
    expect(decoded).toContain("Saç kəsimi");
    expect(decoded).toContain("22 iyul, 14:30");
  });

  it("every template renders a non-empty string with and without vars", () => {
    for (const key of KEYS) {
      expect(WA_TEMPLATES[key]({}).trim().length).toBeGreaterThan(0);
      expect(
        WA_TEMPLATES[key]({ client: "A", salon: "S", service: "X", when: "W", link: "L" }).trim()
          .length,
      ).toBeGreaterThan(0);
    }
  });

  it("greets by name only when a client name is given", () => {
    expect(WA_TEMPLATES.reminder({ client: "Aygün" })).toContain("Salam, Aygün!");
    expect(WA_TEMPLATES.reminder({})).toContain("Salam!");
    expect(WA_TEMPLATES.reminder({})).not.toContain("Salam, ");
  });
});

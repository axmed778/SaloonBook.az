import { describe, it, expect } from "vitest";
import { decideSender, maskPhone } from "./whatsapp-sender";

// decideSender is the pure gating core of resolveWhatsAppSender: it decides
// whether a salon sends from its OWN number or the shared platform one, without
// touching the DB or decrypting anything.
describe("decideSender", () => {
  const creds = { planHasOwnNumber: true, hasSalonCreds: true };

  it("Pro + ACTIVE + credentials → own (salon) number", () => {
    expect(decideSender({ status: "ACTIVE", ...creds })).toBe("salon");
  });

  it("Pro + PENDING → platform (not activated yet)", () => {
    expect(decideSender({ status: "PENDING", ...creds })).toBe("platform");
  });

  it("Pro + DISABLED → platform", () => {
    expect(decideSender({ status: "DISABLED", ...creds })).toBe("platform");
  });

  it("Pro + ACTIVE but missing credentials → platform", () => {
    expect(
      decideSender({ status: "ACTIVE", planHasOwnNumber: true, hasSalonCreds: false }),
    ).toBe("platform");
  });

  it("non-Pro plan → platform even if ACTIVE with credentials (plan is source of truth)", () => {
    expect(
      decideSender({ status: "ACTIVE", planHasOwnNumber: false, hasSalonCreds: true }),
    ).toBe("platform");
  });

  it("no sender status → platform", () => {
    expect(decideSender({ status: null, ...creds })).toBe("platform");
    expect(decideSender({ status: undefined, ...creds })).toBe("platform");
  });
});

describe("maskPhone", () => {
  it("masks the middle, keeps prefix and last two digits", () => {
    const masked = maskPhone("+994 50 123 45 67");
    expect(masked).not.toBeNull();
    expect(masked!.startsWith("+994")).toBe(true);
    expect(masked!.endsWith("67")).toBe(true);
    expect(masked).toContain("•");
    // The raw middle digits must not appear.
    expect(masked).not.toContain("123");
  });

  it("returns null for empty input", () => {
    expect(maskPhone(null)).toBeNull();
    expect(maskPhone(undefined)).toBeNull();
    expect(maskPhone("")).toBeNull();
  });

  it("returns the input unchanged when too short to mask", () => {
    expect(maskPhone("12")).toBe("12");
  });
});

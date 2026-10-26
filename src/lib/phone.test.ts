import { describe, it, expect } from "vitest";
import { AZ_PHONE_RE, azLocalDigits } from "./phone";

describe("azLocalDigits", () => {
  it("keeps a plain national number", () => {
    expect(azLocalDigits("501234567")).toBe("501234567");
    expect(azLocalDigits("50 123 45 67")).toBe("501234567");
  });

  it("drops the local trunk 0 instead of cutting the last digit", () => {
    expect(azLocalDigits("0552136000")).toBe("552136000");
    expect(azLocalDigits("077 575 57 13")).toBe("775755713");
  });

  it("drops a pasted country code", () => {
    expect(azLocalDigits("+994 50 123 45 67")).toBe("501234567");
    expect(azLocalDigits("00994501234567")).toBe("501234567");
  });

  it("keeps a national number that itself starts with 994", () => {
    expect(azLocalDigits("994123456")).toBe("994123456");
  });

  it("never yields more than 9 digits", () => {
    expect(azLocalDigits("5012345678")).toBe("501234567");
  });
});

describe("AZ_PHONE_RE", () => {
  it("accepts +994 with a 9-digit national number", () => {
    expect(AZ_PHONE_RE.test("+994501234567")).toBe(true);
  });

  it("rejects a national number starting with 0", () => {
    expect(AZ_PHONE_RE.test("+994055213600")).toBe(false);
  });

  it("rejects wrong lengths", () => {
    expect(AZ_PHONE_RE.test("+99450123456")).toBe(false);
    expect(AZ_PHONE_RE.test("+9945012345678")).toBe(false);
  });
});

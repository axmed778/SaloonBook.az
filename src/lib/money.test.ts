import { describe, it, expect } from "vitest";
import { parseAznAmount, parseAznToMinor } from "./money";

describe("parseAznAmount", () => {
  it("accepts a comma as the decimal separator", () => {
    // The bug this file exists for: parseFloat("12,50") is 12, and reports
    // success, so the qəpik vanished silently on every booking of that service.
    expect(parseAznAmount("12,50")).toBe(12.5);
    expect(parseAznAmount("0,05")).toBe(0.05);
  });

  it("accepts a dot as the decimal separator", () => {
    expect(parseAznAmount("12.50")).toBe(12.5);
  });

  it("accepts whole numbers and surrounding whitespace", () => {
    expect(parseAznAmount("450")).toBe(450);
    expect(parseAznAmount("  450,50  ")).toBe(450.5);
  });

  it("rejects empty, negative and non-numeric input", () => {
    for (const bad of ["", "   ", "-1", "-0,50", "abc", "12,5,0", "1e", "₼20"]) {
      expect(parseAznAmount(bad)).toBeNull();
    }
  });

  it("rejects infinities rather than passing them through as numbers", () => {
    expect(parseAznAmount("Infinity")).toBeNull();
    expect(parseAznAmount("-Infinity")).toBeNull();
  });
});

describe("parseAznToMinor", () => {
  it("converts to qəpik", () => {
    expect(parseAznToMinor("12,50")).toBe(1250);
    expect(parseAznToMinor("450")).toBe(45_000);
    expect(parseAznToMinor("0,05")).toBe(5);
  });

  it("rounds to the nearest qəpik instead of truncating", () => {
    expect(parseAznToMinor("12,005")).toBe(1201);
    expect(parseAznToMinor("12,004")).toBe(1200);
  });

  it("survives binary floating point at the qəpik boundary", () => {
    // 8.29 * 100 is 828.9999... in IEEE754; truncation would lose a qəpik.
    expect(parseAznToMinor("8,29")).toBe(829);
    expect(parseAznToMinor("1,15")).toBe(115);
    expect(parseAznToMinor("10,07")).toBe(1007);
  });

  it("propagates null for invalid input", () => {
    expect(parseAznToMinor("")).toBeNull();
    expect(parseAznToMinor("abc")).toBeNull();
  });

  it("agrees with the AZN parser on what is valid", () => {
    for (const s of ["12,50", "450", "0", "0,01", "", "abc", "-5"]) {
      expect(parseAznToMinor(s) === null).toBe(parseAznAmount(s) === null);
    }
  });
});

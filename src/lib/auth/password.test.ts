import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, passwordIssues } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("round-trips and salts (two hashes of the same password differ)", () => {
    const h1 = hashPassword("Sekret1!");
    const h2 = hashPassword("Sekret1!");
    expect(h1).not.toBe(h2);
    expect(verifyPassword("Sekret1!", h1)).toBe(true);
    expect(verifyPassword("Sekret1!", h2)).toBe(true);
  });

  it("rejects a wrong password", () => {
    const h = hashPassword("Sekret1!");
    expect(verifyPassword("sekret1!", h)).toBe(false);
    expect(verifyPassword("", h)).toBe(false);
  });

  it("rejects malformed or missing stored hashes instead of throwing", () => {
    expect(verifyPassword("x", null)).toBe(false);
    expect(verifyPassword("x", undefined)).toBe(false);
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "bcrypt:aa:bb")).toBe(false);
  });
});

describe("passwordIssues", () => {
  it("accepts a policy-compliant password", () => {
    expect(passwordIssues("Sekret1!")).toEqual([]);
  });

  it("reports each missing requirement", () => {
    expect(passwordIssues("short")).not.toHaveLength(0);
    expect(passwordIssues("alllowercase1!")).toHaveLength(1); // no uppercase
    expect(passwordIssues("ALLUPPERCASE1!")).toHaveLength(1); // no lowercase
    expect(passwordIssues("NoDigitsHere!")).toHaveLength(1);
    expect(passwordIssues("NoSpecial123")).toHaveLength(1);
    expect(passwordIssues("")).toHaveLength(5);
  });
});

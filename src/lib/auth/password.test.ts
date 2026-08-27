import { scryptSync } from "node:crypto";
import { describe, it, expect } from "vitest";
import { hashPassword, hashPasswordSync, verifyPassword, needsRehash, passwordIssues } from "./password";

// Scrypt at the current cost costs a few hundred ms per call, so the hashing
// tests get a generous timeout rather than relying on vitest's 5s default.
const SLOW = 20_000;

/** Reproduces the pre-upgrade format: `scrypt:<saltHex>:<hashHex>`, Node defaults. */
function legacyHash(pw: string, saltHex = "00112233445566778899aabbccddeeff"): string {
  const hash = scryptSync(pw, Buffer.from(saltHex, "hex"), 64);
  return `scrypt:${saltHex}:${hash.toString("hex")}`;
}

describe("hashPassword / verifyPassword", () => {
  it(
    "round-trips and salts (two hashes of the same password differ)",
    async () => {
      const h1 = await hashPassword("Sekret1!");
      const h2 = await hashPassword("Sekret1!");
      expect(h1).not.toBe(h2);
      expect(await verifyPassword("Sekret1!", h1)).toBe(true);
      expect(await verifyPassword("Sekret1!", h2)).toBe(true);
    },
    SLOW,
  );

  it(
    "stores the cost parameters in the hash",
    async () => {
      const h = await hashPassword("Sekret1!");
      expect(h.startsWith("scrypt$131072$8$1$")).toBe(true);
      expect(h.split("$")).toHaveLength(6);
    },
    SLOW,
  );

  it(
    "rejects a wrong password",
    async () => {
      const h = await hashPassword("Sekret1!");
      expect(await verifyPassword("sekret1!", h)).toBe(false);
      expect(await verifyPassword("", h)).toBe(false);
    },
    SLOW,
  );

  it("rejects malformed or missing stored hashes instead of throwing", async () => {
    expect(await verifyPassword("x", null)).toBe(false);
    expect(await verifyPassword("x", undefined)).toBe(false);
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt:aa:bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt:aa:")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$131072$8$1$aa$bb")).toBe(false);
    // Non-power-of-two / nonsense cost must be refused, not handed to scrypt.
    expect(await verifyPassword("x", "scrypt$3$8$1$aa$bb")).toBe(false);
    expect(await verifyPassword("x", "scrypt$abc$8$1$aa$bb")).toBe(false);
  });

  it("verifies hashes written by the legacy parameter-less format", async () => {
    const legacy = legacyHash("Sekret1!");
    expect(await verifyPassword("Sekret1!", legacy)).toBe(true);
    expect(await verifyPassword("Sekret2!", legacy)).toBe(false);
  });

  it(
    "hashPasswordSync produces hashes the async path verifies",
    async () => {
      const h = hashPasswordSync("Sekret1!");
      expect(await verifyPassword("Sekret1!", h)).toBe(true);
      expect(await verifyPassword("nope", h)).toBe(false);
    },
    SLOW,
  );
});

describe("needsRehash", () => {
  it("flags legacy hashes for a transparent upgrade", () => {
    expect(needsRehash(legacyHash("Sekret1!"))).toBe(true);
  });

  it(
    "leaves freshly written hashes alone",
    async () => {
      expect(needsRehash(await hashPassword("Sekret1!"))).toBe(false);
      expect(needsRehash(hashPasswordSync("Sekret1!"))).toBe(false);
    },
    SLOW,
  );

  it("flags new-format hashes written below the current cost", () => {
    expect(needsRehash("scrypt$16384$8$1$aabb$ccdd")).toBe(true);
    expect(needsRehash("scrypt$131072$4$1$aabb$ccdd")).toBe(true);
  });

  it("ignores empty or unreadable values (those never verify anyway)", () => {
    expect(needsRehash(null)).toBe(false);
    expect(needsRehash(undefined)).toBe(false);
    expect(needsRehash("not-a-hash")).toBe(false);
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

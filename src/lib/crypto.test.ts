// The crypto helper derives its key from WHATSAPP_ENCRYPTION_KEY at call time,
// so setting it here (before any encrypt/decrypt call) is enough.
process.env.WHATSAPP_ENCRYPTION_KEY = "test-encryption-key-do-not-use-in-prod";

import { describe, it, expect } from "vitest";
import { encryptSecret, decryptSecret, hasEncryptionKey } from "./crypto";

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a token", () => {
    const token = "EAAG-super-secret-whatsapp-token-1234567890";
    const enc = encryptSecret(token);
    expect(enc).not.toContain(token); // ciphertext must not leak the plaintext
    expect(decryptSecret(enc)).toBe(token);
  });

  it("uses a fresh IV each call (same input → different ciphertext)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-value");
    expect(decryptSecret(b)).toBe("same-value");
  });

  it("produces the v1 envelope shape", () => {
    const enc = encryptSecret("x");
    const parts = enc.split(".");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("v1");
  });

  it("rejects a tampered ciphertext (GCM auth failure)", () => {
    const enc = encryptSecret("tamper-me");
    const parts = enc.split(".");
    // Flip the last char of the ciphertext segment.
    const last = parts[3];
    parts[3] = (last.slice(0, -1) + (last.endsWith("A") ? "B" : "A"));
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("rejects a malformed envelope", () => {
    expect(() => decryptSecret("not-an-envelope")).toThrow();
    expect(() => decryptSecret("v2.a.b.c")).toThrow();
  });

  it("reports the key is configured", () => {
    expect(hasEncryptionKey()).toBe(true);
  });
});

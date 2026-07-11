// Password hashing & policy. Uses Node's built-in node:crypto (scrypt) so we add
// no dependencies. Hashes live only in our own DB (privacy); the owner controls
// the rules — deliberately permissive enough to allow a weak test account.

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const SCHEME = "scrypt";
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Hashes a plaintext password as `scrypt:<saltHex>:<hashHex>`. */
export function hashPassword(pw: string): string {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(pw, salt, KEYLEN);
  return `${SCHEME}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Constant-time verification of a plaintext password against a stored hash. */
export function verifyPassword(pw: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== SCHEME || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(pw, Buffer.from(saltHex, "hex"), expected.length);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/**
 * Returns stable issue CODES for why a password is rejected, or an empty array
 * if it passes. Callers translate them (Auth.passwordIssues.<code>); the seed
 * uses the codes as-is. Rules: 8+ chars, ≥1 lowercase, ≥1 uppercase, ≥1 digit,
 * ≥1 special character.
 */
export type PasswordIssue = "min8" | "lower" | "upper" | "digit" | "special";

export function passwordIssues(pw: string): PasswordIssue[] {
  const issues: PasswordIssue[] = [];
  if (pw.length < 8) issues.push("min8");
  if (!/[a-z]/.test(pw)) issues.push("lower");
  if (!/[A-Z]/.test(pw)) issues.push("upper");
  if (!/[0-9]/.test(pw)) issues.push("digit");
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push("special");
  return issues;
}

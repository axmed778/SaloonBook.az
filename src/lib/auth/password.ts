// Password hashing & policy. Uses Node's built-in node:crypto (scrypt) so we add
// no dependencies. Hashes live only in our own DB (privacy); the owner controls
// the rules — deliberately permissive enough to allow a weak test account.
//
// Hashing is async on purpose: scrypt is memory-hard by design, and the sync
// variant parks the whole Node event loop for the duration — with concurrent
// logins that turns a security control into an availability problem.

import { randomBytes, scrypt, scryptSync, timingSafeEqual, type ScryptOptions } from "node:crypto";

const SCHEME = "scrypt";
const KEYLEN = 64;
const SALT_BYTES = 16;

/** Cost we hash with today (OWASP 2023 guidance for scrypt: N=2^17, r=8, p=1). */
const TARGET_N = 131072;
const TARGET_R = 8;
const TARGET_P = 1;

// The original format was `scrypt:<saltHex>:<hashHex>` and encoded no cost, so
// it implicitly used Node's defaults. Those hashes are in production and must
// keep verifying; needsRehash() flags them for a silent upgrade on next login.
const LEGACY_N = 16384;
const LEGACY_R = 8;
const LEGACY_P = 1;

// Refuse absurd costs read back from storage: a corrupted N would otherwise let
// a stored value dictate a multi-gigabyte allocation on the login path.
const MAX_N = 1 << 20;

type ScryptParams = { N: number; r: number; p: number };

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
}

// Node throws ERR_CRYPTO_INVALID_SCRYPT_PARAM as soon as 128 * N * r exceeds
// maxmem (32 MB by default), which our target cost does — so raise the ceiling
// with headroom rather than tuning it at each call site.
function optionsFor({ N, r, p }: ScryptParams): ScryptOptions {
  return { N, r, p, maxmem: 256 * N * r };
}

function derive(pw: string, salt: Buffer, keylen: number, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw, salt, keylen, optionsFor(params), (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

function encode(params: ScryptParams, salt: Buffer, hash: Buffer): string {
  return [SCHEME, params.N, params.r, params.p, salt.toString("hex"), hash.toString("hex")].join("$");
}

type ParsedHash = { params: ScryptParams; salt: Buffer; hash: Buffer; legacy: boolean };

/** Splits a stored hash of either format, or returns null if it is unusable. */
function parseHash(stored: string): ParsedHash | null {
  // The legacy format is hex and colons only, so a `$` unambiguously marks the
  // self-describing format.
  if (stored.includes("$")) {
    const [scheme, n, r, p, saltHex, hashHex] = stored.split("$");
    if (scheme !== SCHEME || !saltHex || !hashHex) return null;
    const params = { N: Number(n), r: Number(r), p: Number(p) };
    if (!isPowerOfTwo(params.N) || params.N > MAX_N) return null;
    if (!Number.isInteger(params.r) || params.r < 1) return null;
    if (!Number.isInteger(params.p) || params.p < 1) return null;
    return { params, salt: Buffer.from(saltHex, "hex"), hash: Buffer.from(hashHex, "hex"), legacy: false };
  }

  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== SCHEME || !saltHex || !hashHex) return null;
  return {
    params: { N: LEGACY_N, r: LEGACY_R, p: LEGACY_P },
    salt: Buffer.from(saltHex, "hex"),
    hash: Buffer.from(hashHex, "hex"),
    legacy: true,
  };
}

/** Hashes a plaintext password as `scrypt$N$r$p$<saltHex>$<hashHex>`. */
export async function hashPassword(pw: string): Promise<string> {
  const params: ScryptParams = { N: TARGET_N, r: TARGET_R, p: TARGET_P };
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(pw, salt, KEYLEN, params);
  return encode(params, salt, hash);
}

/**
 * Blocking variant for one-shot CLI contexts (the seed, scripts/set-password).
 * Never call this from a request path — see the note at the top of the file.
 */
export function hashPasswordSync(pw: string): string {
  const params: ScryptParams = { N: TARGET_N, r: TARGET_R, p: TARGET_P };
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(pw, salt, KEYLEN, optionsFor(params));
  return encode(params, salt, hash);
}

/** Constant-time verification of a plaintext password against a stored hash. */
export async function verifyPassword(pw: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const parsed = parseHash(stored);
  // A zero-length key would make scrypt throw rather than simply not match.
  if (!parsed || parsed.hash.length === 0 || parsed.salt.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await derive(pw, parsed.salt, parsed.hash.length, parsed.params);
  } catch {
    // A stored hash we cannot recompute must fail the login, not 500 the route.
    return false;
  }
  if (parsed.hash.length !== actual.length) return false;
  return timingSafeEqual(parsed.hash, actual);
}

/**
 * True when `stored` was produced with weaker settings than we use today —
 * either the legacy parameter-less format or a below-target cost. Call it after
 * a successful verifyPassword() and persist a fresh hashPassword() result to
 * upgrade the user's hash transparently, without asking them to do anything.
 */
export function needsRehash(stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parsed = parseHash(stored);
  // Nothing to upgrade if we cannot read it — such a hash never verifies anyway.
  if (!parsed) return false;
  if (parsed.legacy) return true;
  return parsed.params.N < TARGET_N || parsed.params.r < TARGET_R || parsed.params.p < TARGET_P;
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

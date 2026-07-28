// Phone OTP codes, stored HASHED in Redis keyed by phone.
//
// Security posture:
//   * 6-digit code, cryptographically random (crypto.randomInt — unbiased).
//   * Stored as SHA-256(phone:code:pepper) — a Redis leak can't be replayed as a
//     code (and the phone binding stops a hash being reused for another number).
//   * 5-minute TTL, at most 5 verification attempts, 60s resend cooldown.
//   * FAIL CLOSED: Redis errors propagate to the caller (→ 5xx), never "allow".
//   * The raw code is returned ONLY to the sender (otp-sender) and is NEVER
//     logged or returned to the client. See the "never log codes" rule.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { appRedis } from "@/lib/ratelimit";

export const CODE_TTL_SEC = 5 * 60;
export const RESEND_COOLDOWN_SEC = 60;
export const MAX_ATTEMPTS = 5;
const CODE_LENGTH = 6;

const codeKey = (phone: string) => `otp:code:${phone}`;
const coolKey = (phone: string) => `otp:cool:${phone}`;

// A separate pepper is optional; we fall back to SESSION_SECRET (already required
// in production), so there is no new mandatory secret.
function pepper(): string {
  return (
    process.env.OTP_PEPPER?.trim() ||
    process.env.SESSION_SECRET?.trim() ||
    "dev-insecure-otp-pepper"
  );
}

function hashCode(phone: string, code: string): string {
  return createHash("sha256").update(`${phone}:${code}:${pepper()}`).digest("hex");
}

function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(CODE_LENGTH, "0");
}

interface OtpRecord {
  hash: string;
  attempts: number;
}

export type CreateOtpResult =
  | { ok: true; code: string }
  | { ok: false; reason: "cooldown"; retryAfterSec: number };

/**
 * Create (or replace) the OTP for a phone. Enforces the 60s resend cooldown.
 * Returns the raw code so ONLY the sender can deliver it — do not log it.
 */
export async function createOtp(phone: string): Promise<CreateOtpResult> {
  const cool = await appRedis.get(coolKey(phone));
  if (cool) {
    const ttl = await appRedis.ttl(coolKey(phone));
    return { ok: false, reason: "cooldown", retryAfterSec: ttl > 0 ? ttl : RESEND_COOLDOWN_SEC };
  }

  const code = generateCode();
  const rec: OtpRecord = { hash: hashCode(phone, code), attempts: 0 };
  await appRedis.set(codeKey(phone), JSON.stringify(rec), "EX", CODE_TTL_SEC);
  await appRedis.set(coolKey(phone), "1", "EX", RESEND_COOLDOWN_SEC);
  return { ok: true, code };
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "invalid" | "too_many_attempts" };

/**
 * Verify a submitted code. Consumes the code on success (single use). Increments
 * (and enforces) the attempt counter on mismatch. Constant-time hash compare.
 */
export async function verifyOtp(phone: string, code: string): Promise<VerifyOtpResult> {
  const raw = await appRedis.get(codeKey(phone));
  if (!raw) return { ok: false, reason: "expired" };

  let rec: OtpRecord;
  try {
    rec = JSON.parse(raw) as OtpRecord;
  } catch {
    await appRedis.del(codeKey(phone));
    return { ok: false, reason: "expired" };
  }

  if (rec.attempts >= MAX_ATTEMPTS) {
    await appRedis.del(codeKey(phone));
    return { ok: false, reason: "too_many_attempts" };
  }

  const expected = Buffer.from(rec.hash, "hex");
  const actual = Buffer.from(hashCode(phone, code), "hex");
  const match = expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!match) {
    rec.attempts += 1;
    // Preserve the remaining TTL so a wrong guess doesn't extend the window.
    const ttl = await appRedis.ttl(codeKey(phone));
    await appRedis.set(
      codeKey(phone),
      JSON.stringify(rec),
      "EX",
      ttl > 0 ? ttl : CODE_TTL_SEC,
    );
    return { ok: false, reason: rec.attempts >= MAX_ATTEMPTS ? "too_many_attempts" : "invalid" };
  }

  await appRedis.del(codeKey(phone));
  return { ok: true };
}

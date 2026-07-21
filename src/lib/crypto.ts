// Symmetric encryption for secrets stored at rest (currently: per-salon WhatsApp
// access tokens, see src/lib/whatsapp-sender.ts). AES-256-GCM via node:crypto —
// no external deps, matching the rest of the codebase (scrypt for passwords,
// HMAC-SHA256 for sessions/webhooks).
//
// The key is derived from WHATSAPP_ENCRYPTION_KEY with scrypt so any-length
// secret works. The key is read at call time (not module load) so tests and the
// admin flow can set it lazily, and so a process that never touches encrypted
// secrets doesn't require it.
//
// Ciphertext format (all base64url):  v1.<iv>.<authTag>.<ciphertext>
// The "v1" prefix lets us rotate the scheme later without ambiguity.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SCHEME = "v1";
const ALGO = "aes-256-gcm";
const KEY_LEN = 32; // 256-bit
const IV_LEN = 12; // GCM standard nonce size
const TAG_LEN = 16; // full GCM auth tag (128-bit)
// Static salt: the input secret (WHATSAPP_ENCRYPTION_KEY) is already high-entropy
// and single-purpose, so a fixed salt only serves to bind the KDF to this app.
// Confidentiality rests on the secret + per-message random IV, not the salt.
const KDF_SALT = Buffer.from("salonbook.whatsapp.token.v1");

function deriveKey(): Buffer {
  const secret = process.env.WHATSAPP_ENCRYPTION_KEY;
  if (!secret || secret.trim() === "") {
    throw new Error(
      "WHATSAPP_ENCRYPTION_KEY is not set — cannot encrypt/decrypt WhatsApp sender tokens.",
    );
  }
  return scryptSync(secret, KDF_SALT, KEY_LEN);
}

/** Encrypt a plaintext secret. Returns the `v1.iv.tag.ciphertext` envelope. */
export function encryptSecret(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt a `v1.iv.tag.ciphertext` envelope produced by encryptSecret().
 * Throws on a malformed envelope, a wrong key, or tampering (GCM auth failure) —
 * callers on the hot send path must catch and fall back, never leak the error.
 */
export function decryptSecret(envelope: string): string {
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new Error("Malformed encrypted secret envelope.");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  // Enforce the exact IV/tag sizes we emit. Node's GCM accepts truncated auth
  // tags (down to 4 bytes), which would weaken forgery resistance — reject
  // anything but a full 16-byte tag (defense in depth; our own ciphertext always
  // has one).
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) {
    throw new Error("Malformed encrypted secret envelope.");
  }
  const key = deriveKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]);
  return pt.toString("utf8");
}

/** True when a token-encryption key is configured (used by env checks / admin UI). */
export function hasEncryptionKey(): boolean {
  const secret = process.env.WHATSAPP_ENCRYPTION_KEY;
  return !!secret && secret.trim() !== "";
}

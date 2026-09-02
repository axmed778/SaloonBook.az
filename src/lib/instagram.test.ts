// verifyIgSignature reads IG_APP_SECRET at call time, so each test sets it
// directly. NODE_ENV matters too: the helper fails closed in production and
// skips the check elsewhere.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "node:crypto";
import { verifyIgSignature, graphError } from "./instagram";

const SECRET = "instagram-app-secret-for-tests";
const BODY = JSON.stringify({ object: "instagram", entry: [{ messaging: [] }] });

function sign(body: string, secret: string): string {
  return `sha256=${crypto.createHmac("sha256", secret).update(body, "utf8").digest("hex")}`;
}

const originalSecret = process.env.IG_APP_SECRET;

beforeEach(() => {
  process.env.IG_APP_SECRET = SECRET;
});

afterEach(() => {
  if (originalSecret === undefined) delete process.env.IG_APP_SECRET;
  else process.env.IG_APP_SECRET = originalSecret;
  // NODE_ENV is typed read-only, so it is swapped through vitest's stub helper
  // rather than assigned; this puts "test" back.
  vi.unstubAllEnvs();
});

describe("verifyIgSignature", () => {
  it("accepts a correctly signed body", () => {
    expect(verifyIgSignature(BODY, sign(BODY, SECRET))).toBe(true);
  });

  it("rejects a body that was modified after signing", () => {
    const header = sign(BODY, SECRET);
    expect(verifyIgSignature(BODY.replace("instagram", "tampered"), header)).toBe(false);
  });

  // The whole point of the separate variable: the WhatsApp app secret signs a
  // different app's webhooks and must not validate here.
  it("rejects a signature made with the WhatsApp app secret", () => {
    expect(verifyIgSignature(BODY, sign(BODY, "whatsapp-app-secret"))).toBe(false);
  });

  it("rejects a missing or malformed header", () => {
    expect(verifyIgSignature(BODY, null)).toBe(false);
    expect(verifyIgSignature(BODY, "")).toBe(false);
    expect(verifyIgSignature(BODY, "sha1=abc")).toBe(false);
    expect(verifyIgSignature(BODY, sign(BODY, SECRET).slice("sha256=".length))).toBe(false);
  });

  // timingSafeEqual throws on differing buffer lengths, so a truncated or
  // non-hex digest must be caught by the length guard rather than escaping as
  // a 500 — which would read to Meta as "retry me".
  it("returns false rather than throwing on a short or non-hex digest", () => {
    expect(verifyIgSignature(BODY, "sha256=deadbeef")).toBe(false);
    expect(verifyIgSignature(BODY, "sha256=zzzz")).toBe(false);
    expect(verifyIgSignature(BODY, "sha256=")).toBe(false);
  });

  it("is computed over the raw bytes, not a re-serialized object", () => {
    // Same JSON value, different bytes (key order + whitespace).
    const raw = '{"a":1,"b":2}';
    const reserialized = JSON.stringify({ b: 2, a: 1 });
    const header = sign(raw, SECRET);
    expect(verifyIgSignature(raw, header)).toBe(true);
    expect(verifyIgSignature(reserialized, header)).toBe(false);
  });

  it("fails closed in production when the secret is unset", () => {
    delete process.env.IG_APP_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    // Even a correctly signed body is rejected: with no secret there is nothing
    // to verify against, and an unauthenticated webhook writes to the inbox.
    expect(verifyIgSignature(BODY, sign(BODY, SECRET))).toBe(false);
  });

  it("skips the check outside production when the secret is unset", () => {
    delete process.env.IG_APP_SECRET;
    vi.stubEnv("NODE_ENV", "development");
    expect(verifyIgSignature(BODY, null)).toBe(true);
  });
});

describe("graphError", () => {
  it("surfaces only the message field", () => {
    expect(graphError({ error: { message: "Invalid OAuth access token." } })).toBe(
      "Invalid OAuth access token.",
    );
  });

  it("never leaks a body it does not understand", () => {
    // A Graph error body can echo request parameters, access_token included.
    expect(graphError({ access_token: "IGQVJ-secret" })).toBe("unknown error");
    expect(graphError(null)).toBe("unknown error");
    expect(graphError("boom")).toBe("unknown error");
  });
});

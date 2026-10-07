// Server-side APNs sender (worker-only) for the App Store app's notifications.
// Talks to Apple directly over HTTP/2 with a token-based (.p8) auth key, so no
// extra dependency and no Firebase. Like push.ts, it runs in a "sandbox"
// (log-only) mode when the APNS_* keys are absent, so dev and CI need no keys.
//
// Env:
//   APNS_KEY_ID       10-char key id of the .p8 key (Apple Developer → Keys)
//   APNS_TEAM_ID      10-char Apple Developer team id
//   APNS_PRIVATE_KEY  the .p8 file's contents (literal "\n" escapes are fine)
//   APNS_BUNDLE_ID    app bundle id (default az.salonbook.app)
//   APNS_SANDBOX      "true" to use Apple's development gateway (Xcode debug
//                     builds); TestFlight and App Store builds use production.
import { createSign } from "node:crypto";
import http2 from "node:http2";
import type { PushMessage, PushResult } from "./push";

type ApnsConfig = {
  keyId: string;
  teamId: string;
  privateKey: string;
  bundleId: string;
  host: string;
};

let config: ApnsConfig | null | undefined;

function readConfig(): ApnsConfig | null {
  if (config !== undefined) return config;
  const keyId = process.env.APNS_KEY_ID?.trim();
  const teamId = process.env.APNS_TEAM_ID?.trim();
  const privateKey = process.env.APNS_PRIVATE_KEY?.replace(/\\n/g, "\n").trim();
  if (!keyId || !teamId || !privateKey) {
    config = null;
    return null;
  }
  config = {
    keyId,
    teamId,
    privateKey,
    bundleId: process.env.APNS_BUNDLE_ID?.trim() || "az.salonbook.app",
    host:
      process.env.APNS_SANDBOX === "true"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com",
  };
  return config;
}

// Apple accepts a provider token for up to an hour and rejects refreshing it
// more than once per 20 minutes; 50 minutes sits safely between the two.
const TOKEN_TTL_MS = 50 * 60_000;
let cachedToken: { jwt: string; issuedAt: number } | null = null;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** ES256 provider token (JWT) for APNs. Exported for tests. */
export function signProviderToken(
  key: { keyId: string; teamId: string; privateKey: string },
  nowMs: number,
): string {
  const header = base64url(JSON.stringify({ alg: "ES256", kid: key.keyId }));
  const claims = base64url(JSON.stringify({ iss: key.teamId, iat: Math.floor(nowMs / 1000) }));
  const signature = createSign("SHA256")
    .update(`${header}.${claims}`)
    // JWT wants the raw r||s signature, not DER.
    .sign({ key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${header}.${claims}.${base64url(signature)}`;
}

function providerToken(cfg: ApnsConfig): string {
  const now = Date.now();
  if (cachedToken && now - cachedToken.issuedAt < TOKEN_TTL_MS) return cachedToken.jwt;
  const jwt = signProviderToken(cfg, now);
  cachedToken = { jwt, issuedAt: now };
  return jwt;
}

let session: http2.ClientHttp2Session | null = null;

function getSession(host: string): http2.ClientHttp2Session {
  if (session && !session.closed && !session.destroyed) return session;
  const s = http2.connect(host);
  // A dropped connection is simply re-opened on the next send.
  s.on("error", () => {});
  s.on("close", () => {
    if (session === s) session = null;
  });
  // Don't keep a one-off script alive just for an idle APNs connection.
  s.unref();
  session = s;
  return s;
}

/** The body Apple shows, plus our own keys the app reads when it is tapped. */
export function apnsPayload(message: PushMessage): string {
  return JSON.stringify({
    aps: {
      alert: { title: message.title, body: message.body },
      sound: "default",
    },
    url: message.url,
  });
}

/** Apple's reasons that mean the token will never work again. */
const DEAD_TOKEN_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

/** Send one notification to one device token. Never throws. */
export async function sendApnsPush(deviceToken: string, message: PushMessage): Promise<PushResult> {
  const cfg = readConfig();
  if (!cfg) {
    console.log(`[apns:sandbox] -> ${deviceToken.slice(0, 12)}… ${message.title}`);
    return { ok: true, sandbox: true };
  }

  try {
    const headers: http2.OutgoingHttpHeaders = {
      ":method": "POST",
      ":path": `/3/device/${deviceToken}`,
      authorization: `bearer ${providerToken(cfg)}`,
      "apns-topic": cfg.bundleId,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
    };
    // Collapse id has a 64-byte limit; same role as the Web Push tag.
    if (message.tag && Buffer.byteLength(message.tag) <= 64) {
      headers["apns-collapse-id"] = message.tag;
    }

    const { status, body } = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = getSession(cfg.host).request(headers);
        let status = 0;
        let body = "";
        req.setEncoding("utf8");
        req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
        req.on("response", (h) => {
          status = Number(h[":status"] ?? 0);
        });
        req.on("data", (chunk: string) => {
          body += chunk;
        });
        req.on("end", () => resolve({ status, body }));
        req.on("error", reject);
        req.end(apnsPayload(message));
      },
    );

    if (status === 200) return { ok: true };
    let reason = "";
    try {
      reason = (JSON.parse(body) as { reason?: string }).reason ?? "";
    } catch {
      // Empty or non-JSON body: keep the status code only.
    }
    const gone = status === 410 || DEAD_TOKEN_REASONS.has(reason);
    if (!gone) console.error(`[apns] send failed (${status}): ${reason || body.slice(0, 200)}`);
    return { ok: false, gone, statusCode: status };
  } catch (e) {
    console.error(`[apns] send failed: ${(e as Error).message}`);
    return { ok: false, gone: false };
  }
}

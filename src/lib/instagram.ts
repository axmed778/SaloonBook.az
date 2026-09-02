// Instagram Direct (Instagram API with Instagram Login).
//
// This is NOT the Facebook-Login flavour of the Messenger API: the app is an
// Instagram app with its own credentials, and every call goes to
// graph.instagram.com rather than graph.facebook.com.
//
// The distinction that matters most here is the SECRET. IG_APP_SECRET belongs
// to the Instagram app; WHATSAPP_APP_SECRET belongs to the main Meta app used
// for WhatsApp. They are different values signing different webhooks — reusing
// one for the other silently rejects every delivery (or, worse, accepts
// forgeries once someone reuses the wrong constant in the other direction).
//
// Nothing here reads a secret at module scope: values are pulled from
// process.env at call time, so a process that never touches Instagram does not
// need the variables and tests can set them lazily.

import crypto from "node:crypto";
import { GRAPH_TIMEOUT_MS } from "./http";

/** Versioned host for the messaging/profile endpoints. */
export const IG_GRAPH = "https://graph.instagram.com/v21.0";

/** Unversioned host — token refresh lives outside the versioned path. */
export const IG_GRAPH_ROOT = "https://graph.instagram.com";

/** Our own IGSID (the salon's Instagram account). Undefined when unconfigured. */
export function igSelfId(): string | undefined {
  const v = process.env.IG_USER_ID?.trim();
  return v ? v : undefined;
}

/**
 * Verifies Meta's X-Hub-Signature-256 HMAC over the RAW request body using
 * IG_APP_SECRET. Returns true to proceed, false to reject with 401.
 *
 * FAIL-CLOSED in production: with the secret unset every request is rejected.
 * An unverified webhook is a write primitive — it creates threads and messages
 * and moves lastMessageAt — so accepting unsigned bodies would let anyone inject
 * conversations into the salon's inbox. Outside production the check is skipped
 * so local dev against a tunnel stays usable.
 */
export function verifyIgSignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.IG_APP_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      console.error("[ig:webhook] IG_APP_SECRET unset — rejecting webhook");
      return false;
    }
    console.warn("[ig:webhook] IG_APP_SECRET unset — skipping signature check (dev only)");
    return true;
  }
  if (!header || !header.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = header.slice("sha256=".length);

  // Buffer.from(<odd/invalid hex>) truncates rather than throwing, so compare
  // lengths first: timingSafeEqual throws on a length mismatch, and a throw
  // inside the handler would read as a server fault instead of a clean 401.
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

export interface IgProfile {
  name?: string;
  username?: string;
}

/**
 * GET /{IGSID}?fields=name,username — the display name and handle behind an
 * Instagram-scoped id. Only available for users who have messaged us, which is
 * exactly the set we call it for.
 *
 * Throws on a non-2xx so the caller (a BullMQ job) retries with backoff. The
 * error message carries Graph's own message but never the token.
 */
export async function fetchIgProfile(igsid: string, accessToken: string): Promise<IgProfile> {
  const url = new URL(`${IG_GRAPH}/${encodeURIComponent(igsid)}`);
  url.searchParams.set("fields", "name,username");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`[ig] profile fetch failed (${res.status}): ${graphError(body)}`);
  }
  const b = body as { name?: unknown; username?: unknown } | null;
  return {
    name: typeof b?.name === "string" ? b.name : undefined,
    username: typeof b?.username === "string" ? b.username : undefined,
  };
}

export interface IgRefreshResult {
  accessToken: string;
  /** Seconds until the refreshed token expires (Meta returns ~60 days). */
  expiresIn: number;
}

/**
 * Extends a long-lived Instagram Login token.
 *
 * Long-lived tokens last 60 days and are NOT auto-renewed: miss the window and
 * every Instagram call starts failing with an expired-token error that looks
 * like an outage. Meta returns a NEW token string, which is why the caller has
 * to persist it (see src/lib/ig-token.ts) — refreshing without storing the
 * result buys nothing.
 *
 * Constraints from Meta: the token must be at least 24 hours old and still
 * valid. A token that already expired cannot be refreshed; it has to be
 * re-issued through the app's login flow.
 */
export async function refreshIgToken(accessToken: string): Promise<IgRefreshResult> {
  const url = new URL(`${IG_GRAPH_ROOT}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", accessToken);

  const res = await fetch(url, { signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS) });
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`[ig] token refresh failed (${res.status}): ${graphError(body)}`);
  }
  const b = body as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof b?.access_token !== "string" || b.access_token === "") {
    throw new Error("[ig] token refresh returned no access_token");
  }
  return {
    accessToken: b.access_token,
    expiresIn: typeof b.expires_in === "number" ? b.expires_in : 60 * 86_400,
  };
}

/**
 * Pulls Graph's human-readable error message out of a response body.
 * Deliberately narrow: the raw body can echo request parameters (including the
 * access token), so only the `message` field is ever surfaced.
 */
export function graphError(body: unknown): string {
  const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof m === "string" ? m : "unknown error";
}

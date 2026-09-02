// The live Instagram Login access token.
//
// WHY THIS IS NOT JUST process.env.IG_ACCESS_TOKEN
// A long-lived Instagram token expires after 60 days and is renewed by calling
// refresh_access_token, which hands back a NEW token string. No process can
// rewrite a Railway variable, so a refresh whose result is only logged changes
// nothing: 60 days later every Instagram call fails at once. The refreshed
// token is therefore persisted in the single-row IgToken table, and every
// caller reads through here.
//
// Precedence: DB row (if any) wins over the environment. IG_ACCESS_TOKEN is the
// bootstrap value — what you paste in once, from the app dashboard — and stays
// the fallback for a fresh database. To force a re-bootstrap (e.g. after
// re-issuing the token by hand because the old one lapsed past the refresh
// window), delete the IgToken row and restart.
//
// The row holds the token in plaintext, so prisma/security/rls-grants.sql
// REVOKEs it from the restricted salonbook_app role: that role exists to be
// less privileged than DATABASE_URL, and nothing it serves needs Instagram.

import { prisma } from "./prisma";
import { refreshIgToken } from "./instagram";

/** The table holds exactly one row; this is its id. */
const ROW_ID = "default";

// Re-reading the row on every job is a query against a scale-to-zero Postgres
// for a value that changes once a month. Cache it in-process and invalidate on
// write. Short enough that a token refreshed by another process (the backfill
// script) is picked up quickly.
const CACHE_TTL_MS = 5 * 60_000;
let cached: { token: string; readAt: number } | null = null;

/**
 * The token to sign Instagram API calls with, or null when Instagram is not
 * configured at all (no DB row and no IG_ACCESS_TOKEN) — callers treat that as
 * "feature off" and skip, rather than throwing.
 */
export async function igAccessToken(): Promise<string | null> {
  if (cached && Date.now() - cached.readAt < CACHE_TTL_MS) return cached.token;

  let stored: string | null = null;
  try {
    const row = await prisma.igToken.findUnique({
      where: { id: ROW_ID },
      select: { accessToken: true },
    });
    stored = row?.accessToken?.trim() || null;
  } catch (e) {
    // A database hiccup must not make a configured integration look unconfigured
    // — fall through to the environment value rather than returning null.
    console.error("[ig:token] could not read stored token, falling back to env", e);
  }

  const token = stored ?? (process.env.IG_ACCESS_TOKEN?.trim() || null);
  if (token) cached = { token, readAt: Date.now() };
  return token;
}

/** Persist a freshly refreshed token and drop the in-process cache. */
export async function storeIgToken(accessToken: string, expiresInSeconds: number): Promise<void> {
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
  await prisma.igToken.upsert({
    where: { id: ROW_ID },
    create: { id: ROW_ID, accessToken, expiresAt },
    update: { accessToken, expiresAt },
  });
  cached = { token: accessToken, readAt: Date.now() };
}

/**
 * Refresh the long-lived token and store the result. Called monthly from the
 * worker (see worker/processors/ig.ts) — twice the margin the 60-day lifetime
 * needs, so one failed run is not an outage.
 *
 * Returns the new expiry, or null when Instagram is unconfigured. Throws on a
 * Graph failure so BullMQ retries with backoff.
 */
export async function refreshAndStoreIgToken(): Promise<Date | null> {
  const current = await igAccessToken();
  if (!current) return null;

  const { accessToken, expiresIn } = await refreshIgToken(current);
  await storeIgToken(accessToken, expiresIn);
  return new Date(Date.now() + expiresIn * 1000);
}

/** Test/maintenance hook: forget the cached token. */
export function resetIgTokenCache(): void {
  cached = null;
}

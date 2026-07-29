// Public CLIENT sessions (phone-OTP consumers), separate from owner sessions.
//
// Same stateless signed-cookie design as src/lib/auth/session.ts, but a distinct
// cookie (`sb_client`) and a domain-separated HMAC (the signed payload is
// prefixed with "c."), so an owner session token can never be replayed as a
// client one and vice-versa. The two identities are independent — a device may
// hold both cookies at once.
//
// Cookie = base64url(JSON{cid,iat}) + "." + HMAC-SHA256("c." + payload, SESSION_SECRET).

import { cache } from "react";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "sb_client";
const MAX_AGE_SEC = 60 * 60 * 24 * 90; // ~90 days — consumer sessions are long-lived
const DEV_FALLBACK_SECRET = "dev-insecure-session-secret-change-me";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.trim() !== "") return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[client-auth] SESSION_SECRET is required in production. Refusing the insecure dev fallback.",
    );
  }
  return DEV_FALLBACK_SECRET;
}

interface ClientSessionPayload {
  cid: string;
  iat: number; // issued-at, epoch seconds
}

// "c." domain separation keeps client tokens disjoint from owner tokens even
// though they share SESSION_SECRET.
function sign(data: string): string {
  return createHmac("sha256", secret()).update("c." + data).digest("base64url");
}

function encode(payload: ClientSessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string | undefined): ClientSessionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as ClientSessionPayload;
    if (typeof parsed?.cid !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Issues a client session cookie for the given client id. */
export async function setClientSession(clientId: string): Promise<void> {
  const token = encode({ cid: clientId, iat: Math.floor(Date.now() / 1000) });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

/** Clears the client session cookie (logout). */
export async function clearClientSession(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export interface ClientSession {
  id: string;
  phone: string;
  name: string | null;
}

/**
 * Reads and verifies the client cookie, then loads the Client fresh from the DB.
 * Returns null when there's no valid client session. The verified `phone` is the
 * ONLY key used to scope a client's data (history, reviews) — callers must never
 * take a phone from the request.
 *
 * Wrapped in React's `cache` so multiple calls within one render (e.g. the salon
 * page prefill + the header account link) share a single DB read.
 */
export const getClientSession = cache(async (): Promise<ClientSession | null> => {
  const store = await cookies();
  const payload = decode(store.get(COOKIE_NAME)?.value);
  if (!payload) return null;

  const client = await prisma.client.findUnique({
    where: { id: payload.cid },
    select: { id: true, phone: true, name: true },
  });
  if (!client) return null;
  return { id: client.id, phone: client.phone, name: client.name };
});

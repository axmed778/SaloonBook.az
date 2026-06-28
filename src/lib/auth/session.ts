// Stateless signed-cookie sessions. No server-side session store: the cookie is
// `base64url(JSON{uid,iat})` + "." + HMAC-SHA256(payload, SESSION_SECRET). We verify
// the HMAC (constant-time) on every read, then load the User fresh from the DB.
//
// Route protection runs in the dashboard layout (Node runtime), not Edge
// middleware, so we can keep all crypto on node:crypto.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "sb_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // ~30 days

// In production SESSION_SECRET must be set (see .env.example). In dev we fall back
// to a constant and warn, so local setup stays frictionless (matches env.ts policy).
const DEV_FALLBACK_SECRET = "dev-insecure-session-secret-change-me";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.trim() !== "") return s;
  console.warn(
    "[auth] WARNING: SESSION_SECRET is unset — using an insecure dev fallback. " +
      "Set SESSION_SECRET before deploying.",
  );
  return DEV_FALLBACK_SECRET;
}

interface SessionPayload {
  uid: string;
  iat: number; // issued-at, epoch seconds
}

function sign(data: string): string {
  return createHmac("sha256", secret()).update(data).digest("base64url");
}

function encode(payload: SessionPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body)}`;
}

function decode(token: string | undefined): SessionPayload | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;

  const expected = sign(body);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as SessionPayload;
    if (typeof parsed?.uid !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Issues a session cookie for the given user id. */
export async function setSession(userId: string): Promise<void> {
  const token = encode({ uid: userId, iat: Math.floor(Date.now() / 1000) });
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SEC,
  });
}

/** Clears the session cookie (logout). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export interface Session {
  user: {
    id: string;
    email: string;
    fullName: string | null;
    isPlatformAdmin: boolean;
  };
  /** Role of the user's (single, MVP) membership, if any. */
  role: Role | null;
  /** Salon the user owns/works at, derived from membership, if any. */
  salonId: string | null;
  isAdmin: boolean;
}

/**
 * Reads and verifies the session cookie, then loads the User + first membership.
 * Returns null when there is no valid session.
 */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const payload = decode(store.get(COOKIE_NAME)?.value);
  if (!payload) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.uid },
    select: {
      id: true,
      email: true,
      fullName: true,
      isPlatformAdmin: true,
      memberships: {
        select: { role: true, salonId: true, accountId: true },
        take: 1,
      },
    },
  });
  if (!user) return null;

  const membership = user.memberships[0] ?? null;
  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
    },
    role: membership?.role ?? null,
    salonId: membership?.salonId ?? null,
    isAdmin: user.isPlatformAdmin,
  };
}

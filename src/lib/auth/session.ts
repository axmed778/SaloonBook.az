// Stateless signed-cookie sessions. No server-side session store: the cookie is
// `base64url(JSON{uid,iat})` + "." + HMAC-SHA256(payload, SESSION_SECRET). We verify
// the HMAC (constant-time) on every read, then load the User fresh from the DB.
//
// Route protection runs in the dashboard layout (Node runtime), not Edge
// middleware, so we can keep all crypto on node:crypto.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { effectivePlan } from "@/lib/subscription";
import { buildSession, type Session } from "./session-state";

export type { Session, SessionBranch, StaffBlockedReason } from "./session-state";

const COOKIE_NAME = "sb_session";
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // ~30 days

// Active-branch override for multi-branch (Pro) owners. Stores a salon id the
// owner picked in the dashboard branch switcher; getSession() validates it
// against the account's ACTIVE salons on every read, so a stale/foreign value
// silently falls back to the membership's home salon.
const BRANCH_COOKIE = "sb_branch";
const BRANCH_MAX_AGE_SEC = 60 * 60 * 24 * 180; // ~6 months

// In production SESSION_SECRET must be set (see .env.example). In dev we fall back
// to a constant and warn, so local setup stays frictionless (matches env.ts policy).
const DEV_FALLBACK_SECRET = "dev-insecure-session-secret-change-me";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.trim() !== "") return s;
  // Defense-in-depth: assertEnv() already refuses to boot in production without
  // SESSION_SECRET, but never sign or verify a cookie with the public dev
  // fallback in prod even if that guard is somehow bypassed.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "[auth] SESSION_SECRET is required in production. Refusing to use the insecure dev fallback.",
    );
  }
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
    // Enforce MAX_AGE_SEC HERE, not just as the cookie's maxAge. That attribute
    // is a request to the browser and nothing more: a token kept outside a
    // browser — copied from a device backup, a stolen profile directory, an
    // export — stayed valid forever, because `iat` was written into every token
    // and then never read. The only server-side check was sessionsValidFrom,
    // which only moved on password reset.
    if (typeof parsed.iat !== "number" || !Number.isFinite(parsed.iat)) return null;
    if (parsed.iat + MAX_AGE_SEC < Math.floor(Date.now() / 1000)) return null;
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

/**
 * Logs the user out: revokes their sessions server-side, then drops the cookie.
 *
 * Dropping the cookie alone left the token itself valid — whoever still held a
 * copy could keep using it, and "log out" is precisely the action a user takes
 * when they want that to stop.
 *
 * This revokes EVERY session for the user, not just this device. The session is
 * a stateless signed cookie with no server-side record of individual sessions,
 * so there is nothing finer to revoke without adding a session store or a
 * denylist; and for a tool where the realistic case is a shared reception device,
 * "log me out everywhere" is the safer default anyway. The cost is that logging
 * out on the tablet also signs the owner out on their phone.
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();

  // Read the cookie BEFORE clearing it, and revoke first: if the update throws,
  // we still clear, but we never report a logout that revoked nothing.
  const payload = decode(store.get(COOKIE_NAME)?.value);
  if (payload) {
    try {
      // updateMany, not update: a token for a since-deleted user must not throw.
      await prisma.user.updateMany({
        where: { id: payload.uid },
        data: { sessionsValidFrom: new Date() },
      });
    } catch (e) {
      console.error("[auth] logout revoke failed", e);
    }
  }

  store.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** Persists the owner's active-branch choice (validated on every getSession). */
export async function setActiveBranch(salonId: string): Promise<void> {
  const store = await cookies();
  store.set(BRANCH_COOKIE, salonId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: BRANCH_MAX_AGE_SEC,
  });
}

/**
 * Reads and verifies the session cookie, then loads the User + first membership
 * (with the account's subscription and ACTIVE salons, so the active branch and
 * plan gating resolve in the same query) and hands them to buildSession(), which
 * owns every rule about what the login may reach. Returns null when there is no
 * valid session.
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
      sessionsValidFrom: true,
      memberships: {
        select: {
          role: true,
          salonId: true,
          accountId: true,
          employeeId: true,
          disabledAt: true,
          // A master's login is only as alive as the master it points at.
          employee: { select: { isActive: true } },
          account: {
            select: {
              offerVersion: true,
              privacyVersion: true,
              subscription: {
                select: {
                  plan: true,
                  status: true,
                  trialEndsAt: true,
                  currentPeriodEnd: true,
                  extraBranches: true,
                },
              },
              salons: {
                where: { status: "ACTIVE" },
                orderBy: { createdAt: "asc" },
                select: { id: true, name: true, address: true },
              },
            },
          },
        },
        take: 1,
      },
    },
  });
  if (!user) return null;

  // Reject cookies minted before the account's session cutoff (bumped on
  // password reset AND on logout). Compared at second granularity to match the
  // cookie's `iat`, so a freshly issued cookie is never falsely invalidated.
  if (
    user.sessionsValidFrom &&
    payload.iat < Math.floor(user.sessionsValidFrom.getTime() / 1000)
  ) {
    return null;
  }

  const membership = user.memberships[0] ?? null;
  const { session, unknownRole } = buildSession({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
    },
    membership,
    plan: effectivePlan(membership?.account.subscription ?? null),
    branchCookie: store.get(BRANCH_COOKIE)?.value,
  });
  if (unknownRole !== null) {
    // The login is blocked rather than failing the request: the database knows a
    // role this deploy does not (a migration ahead of its code, or a bad write).
    console.warn(
      `[auth] user ${user.id} has membership role "${unknownRole}", which this build does not map — login blocked`,
    );
  }
  return session;
}

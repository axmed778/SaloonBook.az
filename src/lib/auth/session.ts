// Stateless signed-cookie sessions. No server-side session store: the cookie is
// `base64url(JSON{uid,iat})` + "." + HMAC-SHA256(payload, SESSION_SECRET). We verify
// the HMAC (constant-time) on every read, then load the User fresh from the DB.
//
// Route protection runs in the dashboard layout (Node runtime), not Edge
// middleware, so we can keep all crypto on node:crypto.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Plan, Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { effectivePlan } from "@/lib/subscription";
import { featuresFor, limitsFor } from "@/lib/plans";

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

export interface SessionBranch {
  id: string;
  name: string;
  address: string | null;
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
  /**
   * The salon every dashboard page/action is scoped to. For a Pro owner this is
   * the branch picked in the switcher (sb_branch cookie); otherwise the
   * membership's home salon.
   */
  salonId: string | null;
  /** Account behind the membership, if any. */
  accountId: string | null;
  /** Effective (time-aware) plan of the account — FREE when no membership. */
  plan: Plan;
  /** Whether the effective plan includes multi-branch support. */
  multiBranch: boolean;
  /**
   * How many branches the account may have in total: the plan's maxBranches
   * plus paid extra slots (Subscription.extraBranches, Pro only).
   */
  maxBranches: number;
  /** ACTIVE salons (branches) of the account, oldest (primary) first. */
  branches: SessionBranch[];
  isAdmin: boolean;
}

/**
 * Reads and verifies the session cookie, then loads the User + first membership
 * (with the account's subscription and ACTIVE salons, so the active branch and
 * plan gating resolve in the same query). Returns null when there is no valid
 * session.
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
          account: {
            select: {
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
  // password reset). Compared at second granularity to match the cookie's `iat`,
  // so a freshly issued post-reset cookie is never falsely invalidated.
  if (
    user.sessionsValidFrom &&
    payload.iat < Math.floor(user.sessionsValidFrom.getTime() / 1000)
  ) {
    return null;
  }

  const membership = user.memberships[0] ?? null;
  const sub = membership?.account.subscription ?? null;
  const plan = effectivePlan(sub);
  const multiBranch = featuresFor(plan).multiBranch;
  // Paid extra slots only count while the plan actually has multi-branch —
  // after a downgrade they lie dormant until the account is Pro again.
  const maxBranches =
    limitsFor(plan).maxBranches + (multiBranch ? (sub?.extraBranches ?? 0) : 0);
  const branches = membership?.account.salons ?? [];

  // Default scope: the membership's home salon. Owners of a multi-branch (Pro)
  // account may override it via the switcher cookie — but only to a salon that
  // is still an ACTIVE member of THEIR account. Staff stay pinned to theirs.
  let salonId = membership?.salonId ?? null;
  if (membership?.role === "OWNER") {
    if (!salonId) salonId = branches[0]?.id ?? null;
    const picked = store.get(BRANCH_COOKIE)?.value;
    if (picked && multiBranch && branches.some((b) => b.id === picked)) {
      salonId = picked;
    }
  }

  return {
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      isPlatformAdmin: user.isPlatformAdmin,
    },
    role: membership?.role ?? null,
    salonId,
    accountId: membership?.accountId ?? null,
    plan,
    multiBranch,
    maxBranches,
    branches,
    isAdmin: user.isPlatformAdmin,
  };
}

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
import { staffBlockedReason, type StaffBlockedReason } from "./access";

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

export type { StaffBlockedReason };

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
   * Employee the membership is tied to. Always set for a STAFF login (that is
   * what makes it "this master's account"), always null for an OWNER.
   */
  employeeId: string | null;
  /** True when this is a per-master (STAFF) login rather than the owner's. */
  isStaff: boolean;
  /**
   * Why a STAFF login is currently denied its salon, or null when it is fine.
   * When set, `salonId` is deliberately null so every existing salon guard
   * (`requireSalonId`, `where: { salonId }`) fails closed without knowing this
   * rule exists; the dashboard layout reads the reason only to explain it.
   */
  staffBlocked: StaffBlockedReason | null;
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
  /**
   * Legal-document versions the account last accepted. Compared against
   * LEGAL_DOC_VERSION by the dashboard's re-consent gate; null when the account
   * predates consent capture (also treated as stale).
   */
  legal: { offerVersion: string | null; privacyVersion: string | null };
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
          employeeId: true,
          // A staff login is only as alive as the master it points at.
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
  const sub = membership?.account.subscription ?? null;
  const plan = effectivePlan(sub);
  const features = featuresFor(plan);
  const multiBranch = features.multiBranch;

  // Is this a master's own login, and is it still entitled to one? Both answers
  // are derived here, per request, from the plan and the employee row — never
  // from the cookie — so a downgrade or a deactivation takes effect on the very
  // next page load rather than whenever the session happens to expire.
  const isStaff = membership?.role === "STAFF";
  const staffBlocked = staffBlockedReason({
    isStaff,
    staffRolesEnabled: features.staffRoles,
    employeeIsActive: membership?.employee?.isActive,
  });
  // Paid extra slots only count while the plan actually has multi-branch —
  // after a downgrade they lie dormant until the account is Pro again.
  const maxBranches =
    limitsFor(plan).maxBranches + (multiBranch ? (sub?.extraBranches ?? 0) : 0);
  const branches = membership?.account.salons ?? [];

  // Default scope: the membership's home salon. Owners of a multi-branch (Pro)
  // account may override it via the switcher cookie — but only to a salon that
  // is still an ACTIVE member of THEIR account. Staff stay pinned to theirs.
  let salonId = membership?.salonId ?? null;
  // Fail closed: a blocked master keeps a valid session (so the layout can say
  // why) but carries no salon, which is what every dashboard guard already
  // refuses on. No other call site has to know this rule exists.
  if (staffBlocked) salonId = null;
  else if (membership?.role === "OWNER") {
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
    employeeId: membership?.employeeId ?? null,
    isStaff,
    staffBlocked,
    salonId,
    accountId: membership?.accountId ?? null,
    plan,
    multiBranch,
    maxBranches,
    branches,
    legal: {
      offerVersion: membership?.account.offerVersion ?? null,
      privacyVersion: membership?.account.privacyVersion ?? null,
    },
    isAdmin: user.isPlatformAdmin,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { localeFromCookie } from "@/i18n/request-locale";
import { rejectCrossOrigin } from "../_origin";

export const dynamic = "force-dynamic";

// Brute-force protection (Redis-backed, fail-open like the booking routes).
// Per-IP bounds one attacker; per-email bounds a distributed attack on one
// account. Windows are short so a legit user who trips a limit isn't locked
// out for long.
const LIMITS = {
  ip: { limit: 10, windowSec: 60 },
  email: { limit: 10, windowSec: 300 },
};

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
  // CAPTCHA token from the form. Only required when TURNSTILE_SECRET_KEY is
  // configured (see src/lib/turnstile.ts).
  turnstileToken: z.string().max(2048).optional(),
});

// Timing-oracle defense: skipping scrypt for an unknown email answered visibly
// faster than a real one, which enumerates the whole customer list. Every login
// now runs exactly one scrypt — against this throwaway hash when there is no
// user to check. It comes out of hashPassword itself, so its cost parameters
// can never drift away from the ones real accounts are stored with.
let absentUserHash: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  if (!absentUserHash) {
    absentUserHash = hashPassword(randomBytes(32).toString("hex")).catch((e) => {
      absentUserHash = null; // never cache a failure — retry on the next login
      throw e;
    });
  }
  return absentUserHash;
}

function tooMany(resetSec: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(resetSec) } },
  );
}

export async function POST(req: NextRequest) {
  const csrf = rejectCrossOrigin(req);
  if (csrf) return csrf;

  const t = await getTranslations({ locale: await localeFromCookie(), namespace: "Auth" });

  const ip = clientIp(req);
  const ipRl = await rateLimit(`login:ip:${ip}`, LIMITS.ip.limit, LIMITS.ip.windowSec);
  if (!ipRl.allowed) return tooMany(ipRl.resetSec, t("tooManyAttempts"));

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  // A no-op unless Turnstile is configured, so an unconfigured deploy keeps
  // logging people in instead of locking everyone out.
  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
    return NextResponse.json({ error: t("api.captchaFailed") }, { status: 403 });
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const emailRl = await rateLimit(
    `login:email:${normalizedEmail}`,
    LIMITS.email.limit,
    LIMITS.email.windowSec,
  );
  if (!emailRl.allowed) return tooMany(emailRl.resetSec, t("tooManyAttempts"));

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      passwordHash: true,
      memberships: { select: { account: { select: { status: true } } } },
    },
  });

  // Always verify — against the dummy hash when the email is unknown or the
  // user is SSO-only (passwordHash null). Same response and same cost either
  // way, so we leak neither which emails are registered nor how they sign in.
  const stored = user?.passwordHash ?? (await dummyHash());
  const ok = await verifyPassword(parsed.data.password, stored);
  if (!ok || !user) {
    return NextResponse.json({ error: t("api.invalidCredentials") }, { status: 401 });
  }

  // Account.status is the platform's off switch for a tenant, and until now
  // nothing read it — SUSPENDED was decorative. Refuse the session when none of
  // the user's accounts is active. Platform admins hold no membership at all,
  // so an empty list means "nothing to check", not "suspended".
  const statuses = user.memberships.map((m) => m.account.status);
  if (statuses.length > 0 && !statuses.includes("ACTIVE")) {
    return NextResponse.json({ error: t("api.accountSuspended") }, { status: 403 });
  }

  // Opportunistic upgrade to today's hashing cost, now that we hold the
  // plaintext. Best-effort on purpose: the credentials are already proven, so a
  // write failure must never turn a valid login into an error.
  try {
    if (needsRehash(user.passwordHash)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(parsed.data.password) },
      });
    }
  } catch (e) {
    console.error("[auth/login] password rehash failed", e);
  }

  await setSession(user.id);
  return NextResponse.json({ ok: true });
}

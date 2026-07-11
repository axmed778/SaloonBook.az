import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { localeFromCookie } from "@/i18n/request-locale";

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
});

function tooMany(resetSec: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(resetSec) } },
  );
}

export async function POST(req: NextRequest) {
  const t = await getTranslations({ locale: await localeFromCookie(), namespace: "Auth" });

  const ipRl = await rateLimit(`login:ip:${clientIp(req)}`, LIMITS.ip.limit, LIMITS.ip.windowSec);
  if (!ipRl.allowed) return tooMany(ipRl.resetSec, t("tooManyAttempts"));

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
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
    select: { id: true, passwordHash: true },
  });

  // Same response whether the email is unknown or the password is wrong, so we
  // don't leak which emails are registered.
  const ok = user ? verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!ok || !user) {
    return NextResponse.json({ error: t("api.invalidCredentials") }, { status: 401 });
  }

  await setSession(user.id);
  return NextResponse.json({ ok: true });
}

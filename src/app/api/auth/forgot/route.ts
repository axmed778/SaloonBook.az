import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { localeFromCookie } from "@/i18n/request-locale";

export const dynamic = "force-dynamic";

// Request a password-reset link. ALWAYS answers the same generic 200 whether
// the email is registered or not, so the endpoint can't be used to enumerate
// accounts. The raw token goes only into the email; the DB stores its SHA-256.

const TOKEN_TTL_MIN = 60;

const LIMITS = {
  ip: { limit: 5, windowSec: 900 },
  email: { limit: 3, windowSec: 900 },
  // "No account" emails go to addresses that may never have interacted with us,
  // so this endpoint could be abused to mail arbitrary recipients (harming
  // sender reputation). Cap them tightly per IP per day. Legit resets go to
  // REGISTERED addresses and never hit this branch, so they're unaffected.
  noAccountIp: { limit: 3, windowSec: 86_400 },
};

const bodySchema = z.object({ email: z.string().email().max(254) });

export async function POST(req: NextRequest) {
  const t = await getTranslations({ locale: await localeFromCookie(), namespace: "Auth" });

  const ip = clientIp(req);
  const ipRl = await rateLimit(`forgot:ip:${ip}`, LIMITS.ip.limit, LIMITS.ip.windowSec);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: t("tooManyAttempts") },
      { status: 429, headers: { "Retry-After": String(ipRl.resetSec) } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const generic = NextResponse.json({ ok: true });

  const emailRl = await rateLimit(
    `forgot:email:${email}`,
    LIMITS.email.limit,
    LIMITS.email.windowSec,
  );
  // Over-limit for this address still returns the generic response — a 429
  // here would itself confirm the address is being processed.
  if (!emailRl.allowed) return generic;

  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true },
  });

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

  // No account with this email: send an informational "no account" email to the
  // address the user typed. The HTTP response below stays identical to the
  // success case, so the endpoint still can't be used to enumerate accounts —
  // the existence signal reaches only the inbox owner, who is exactly the person
  // who needs it (e.g. they registered with a different address and are confused
  // about why no reset link arrived).
  if (!user) {
    // Strict, separate cap for the arbitrary-recipient no-account path. Over the
    // cap we stay silent (same generic response) rather than mail the address.
    const naRl = await rateLimit(
      `forgot:noacct:ip:${ip}`,
      LIMITS.noAccountIp.limit,
      LIMITS.noAccountIp.windowSec,
    );
    if (!naRl.allowed) return generic;

    await sendEmail({
      to: email,
      subject: t("email.noAccountSubject"),
      html: `
        <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto">
          <h2 style="font-size:18px">${t("email.noAccountHeading")}</h2>
          <p style="color:#444;line-height:1.5">${t("email.noAccountBody")}</p>
          <p style="color:#444;line-height:1.5">${t("email.noAccountRegister")}</p>
          <p style="margin:24px 0">
            <a href="${appUrl}/register"
               style="background:#e11d48;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
              ${t("email.noAccountButton")}
            </a>
          </p>
          <p style="color:#888;font-size:13px;line-height:1.5">
            ${t("email.noAccountIgnore")}
          </p>
        </div>`,
    });
    return generic;
  }

  // SSO-only users (passwordHash null) have no password to reset. Stay silent
  // rather than send a "no account" email, which would be misleading for an
  // account that does exist.
  if (!user.passwordHash) return generic;

  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MIN * 60_000),
    },
  });

  const link = `${appUrl}/reset-password?token=${raw}`;
  await sendEmail({
    to: email,
    subject: t("email.resetSubject"),
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="font-size:18px">${t("email.resetHeading")}</h2>
        <p style="color:#444;line-height:1.5">
          ${t("email.resetBody", { minutes: TOKEN_TTL_MIN })}
        </p>
        <p style="margin:24px 0">
          <a href="${link}"
             style="background:#e11d48;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
            ${t("email.resetButton")}
          </a>
        </p>
        <p style="color:#888;font-size:13px;line-height:1.5">
          ${t("email.resetIgnore")}
        </p>
      </div>`,
  });

  return generic;
}

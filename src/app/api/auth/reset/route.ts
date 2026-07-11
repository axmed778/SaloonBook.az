import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordIssues } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { localeFromCookie } from "@/i18n/request-locale";

export const dynamic = "force-dynamic";

// Consume a reset token and set the new password. Tokens are single-use and
// expiring; a successful reset invalidates every other outstanding token for
// the user and logs them in.

const bodySchema = z
  .object({
    token: z.string().min(20).max(200),
    password: z.string().min(1).max(200),
    confirmPassword: z.string().min(1).max(200),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Şifrələr uyğun gəlmir.",
    path: ["confirmPassword"],
  });

export async function POST(req: NextRequest) {
  const t = await getTranslations({ locale: await localeFromCookie(), namespace: "Auth" });

  const ipRl = await rateLimit(`reset:ip:${clientIp(req)}`, 10, 900);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: t("tooManyAttempts") },
      { status: 429, headers: { "Retry-After": String(ipRl.resetSec) } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const mismatch = parsed.error.issues.some((i) => i.path.includes("confirmPassword"));
    return NextResponse.json(
      { error: mismatch ? t("api.passwordMismatch") : t("api.invalidData") },
      { status: 400 },
    );
  }

  const issueCodes = passwordIssues(parsed.data.password);
  if (issueCodes.length > 0) {
    const issues = issueCodes.map((c) => t(`passwordIssues.${c}`));
    return NextResponse.json({ error: t("api.passwordWeak"), issues }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!token || token.usedAt || token.expiresAt < new Date()) {
    return NextResponse.json(
      { error: t("api.resetLinkInvalid") },
      { status: 400 },
    );
  }

  const passwordHash = hashPassword(parsed.data.password);
  await prisma.$transaction([
    // Bump the session cutoff so any cookie stolen before the reset stops
    // working; the fresh cookie issued below (setSession) is minted after and
    // survives.
    prisma.user.update({
      where: { id: token.userId },
      data: { passwordHash, sessionsValidFrom: new Date() },
    }),
    prisma.passwordResetToken.update({
      where: { id: token.id },
      data: { usedAt: new Date() },
    }),
    // Any other outstanding links for this user die with the reset.
    prisma.passwordResetToken.deleteMany({
      where: { userId: token.userId, usedAt: null, id: { not: token.id } },
    }),
  ]);

  await setSession(token.userId);
  return NextResponse.json({ ok: true });
}

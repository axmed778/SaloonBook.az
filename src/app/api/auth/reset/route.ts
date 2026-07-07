import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { hashPassword, passwordIssues } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";
import { rateLimit, clientIp } from "@/lib/ratelimit";

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
  const ipRl = await rateLimit(`reset:ip:${clientIp(req)}`, 10, 900);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: "Çox sayda cəhd. Bir az sonra yenidən yoxlayın." },
      { status: 429, headers: { "Retry-After": String(ipRl.resetSec) } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Yanlış məlumat." },
      { status: 400 },
    );
  }

  const issues = passwordIssues(parsed.data.password);
  if (issues.length > 0) {
    return NextResponse.json({ error: "Şifrə tələblərə uyğun deyil.", issues }, { status: 400 });
  }

  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });
  if (!token || token.usedAt || token.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "Link etibarsızdır və ya vaxtı keçib. Yenidən bərpa tələb edin." },
      { status: 400 },
    );
  }

  const passwordHash = hashPassword(parsed.data.password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: token.userId }, data: { passwordHash } }),
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

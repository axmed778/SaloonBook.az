import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/auth/password";
import { setSession } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid body", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const normalizedEmail = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, passwordHash: true },
  });

  // Same response whether the email is unknown or the password is wrong, so we
  // don't leak which emails are registered.
  const ok = user ? verifyPassword(parsed.data.password, user.passwordHash) : false;
  if (!ok || !user) {
    return NextResponse.json({ error: "E-poçt və ya şifrə yanlışdır." }, { status: 401 });
  }

  await setSession(user.id);
  return NextResponse.json({ ok: true });
}

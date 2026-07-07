import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail } from "@/lib/email";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Request a password-reset link. ALWAYS answers the same generic 200 whether
// the email is registered or not, so the endpoint can't be used to enumerate
// accounts. The raw token goes only into the email; the DB stores its SHA-256.

const TOKEN_TTL_MIN = 60;

const LIMITS = {
  ip: { limit: 5, windowSec: 900 },
  email: { limit: 3, windowSec: 900 },
};

const bodySchema = z.object({ email: z.string().email().max(254) });

export async function POST(req: NextRequest) {
  const ipRl = await rateLimit(`forgot:ip:${clientIp(req)}`, LIMITS.ip.limit, LIMITS.ip.windowSec);
  if (!ipRl.allowed) {
    return NextResponse.json(
      { error: "Çox sayda cəhd. Bir az sonra yenidən yoxlayın." },
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
  // SSO-only users (passwordHash null) have no password to reset.
  if (!user || !user.passwordHash) return generic;

  const raw = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + TOKEN_TTL_MIN * 60_000),
    },
  });

  const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  const link = `${appUrl}/reset-password?token=${raw}`;
  await sendEmail({
    to: email,
    subject: "SalonBook.az — şifrənin bərpası",
    html: `
      <div style="font-family:system-ui,-apple-system,sans-serif;max-width:480px;margin:0 auto">
        <h2 style="font-size:18px">Şifrənin bərpası</h2>
        <p style="color:#444;line-height:1.5">
          SalonBook.az hesabınız üçün şifrə bərpası tələb olunub. Yeni şifrə
          təyin etmək üçün aşağıdakı düyməyə klikləyin — link ${TOKEN_TTL_MIN} dəqiqə etibarlıdır.
        </p>
        <p style="margin:24px 0">
          <a href="${link}"
             style="background:#e11d48;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">
            Yeni şifrə təyin et
          </a>
        </p>
        <p style="color:#888;font-size:13px;line-height:1.5">
          Əgər bu tələbi siz göndərməmisinizsə, bu e-poçtu nəzərə almayın —
          şifrəniz dəyişməyəcək.
        </p>
      </div>`,
  });

  return generic;
}

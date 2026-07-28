import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyOtp } from "@/lib/auth/otp";
import { prisma } from "@/lib/prisma";
import { setClientSession } from "@/lib/auth/client-session";
import { LEGAL_VERSIONS } from "@/lib/legal";

export const dynamic = "force-dynamic";

// Verify an OTP. On success: create the Client (first time — recording consent)
// or sign in an existing one, then issue the client session cookie.
const schema = z.object({
  phone: z.string().regex(/^\+994\d{9}$/),
  code: z.string().regex(/^\d{6}$/),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { phone, code } = parsed.data;
  const ip = clientIp(req);

  const [ipRl, phoneRl] = await Promise.all([
    rateLimit(`otp:vrf:ip:${ip}`, 30, 600),
    rateLimit(`otp:vrf:phone:${phone}`, 10, 600),
  ]);
  if (!ipRl.allowed || !phoneRl.allowed) {
    const resetSec = Math.max(ipRl.resetSec, phoneRl.resetSec);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(resetSec) } },
    );
  }

  let result;
  try {
    result = await verifyOtp(phone, code); // fail-closed
  } catch (e) {
    console.error("[otp:verify] store error", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!result.ok) {
    // invalid / expired -> 400; too_many_attempts -> 429
    const status = result.reason === "too_many_attempts" ? 429 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  // Reaching here means the user consented on the sign-in form (the request step
  // required it), so a first-time Client is created WITH consent recorded.
  const now = new Date();
  const client = await prisma.client.upsert({
    where: { phone },
    create: {
      phone,
      consentAt: now,
      consentVersion: LEGAL_VERSIONS.clientConsent,
      lastLoginAt: now,
    },
    update: { lastLoginAt: now },
    select: { id: true },
  });

  await setClientSession(client.id);
  return NextResponse.json({ ok: true });
}

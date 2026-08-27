import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";
import { createOtp } from "@/lib/auth/otp";
import { sendOtp } from "@/lib/otp-sender";

export const dynamic = "force-dynamic";

// Request an OTP for a phone. Consent (the data-processing checkbox) is required
// to proceed — it's recorded on the Client at verify time. Returns only the
// channel used; the code itself never leaves createOtp -> sendOtp.
const schema = z.object({
  phone: z.string().regex(/^\+994\d{9}$/),
  consent: z.literal(true),
  sms: z.boolean().optional(), // user tapped "send via SMS instead"
  turnstileToken: z.string().max(2048).optional(),
});

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { phone, sms } = parsed.data;
  const ip = clientIp(req);

  // Every OTP request costs real money (WhatsApp/SMS) and burns quota on a
  // number Meta rates us on, so this endpoint gets the same challenge as login
  // and booking. verifyTurnstile keeps its usual semantics: a no-op when
  // Turnstile is unconfigured, so an unconfigured deploy can still sign people
  // in. The rate limits below stay — the challenge raises the cost per attempt,
  // it does not bound the total.
  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
    return NextResponse.json({ error: "captcha_required" }, { status: 403 });
  }

  // Per-phone and per-IP request limits (on top of the per-code 60s cooldown).
  const [ipRl, phoneRl] = await Promise.all([
    rateLimit(`otp:req:ip:${ip}`, 20, 600),
    rateLimit(`otp:req:phone:${phone}`, 5, 600),
  ]);
  if (!ipRl.allowed || !phoneRl.allowed) {
    const resetSec = Math.max(ipRl.resetSec, phoneRl.resetSec);
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(resetSec) } },
    );
  }

  let created;
  try {
    created = await createOtp(phone); // fail-closed: throws if Redis is down
  } catch (e) {
    console.error("[otp:request] store error", e);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (!created.ok) {
    return NextResponse.json(
      { error: "cooldown", retryAfterSec: created.retryAfterSec },
      { status: 429, headers: { "Retry-After": String(created.retryAfterSec) } },
    );
  }

  try {
    const { channel } = await sendOtp(phone, created.code, { forceSms: !!sms });
    return NextResponse.json({ ok: true, channel });
  } catch (e) {
    console.error("[otp:request] send error", e);
    return NextResponse.json({ error: "send_failed" }, { status: 502 });
  }
}

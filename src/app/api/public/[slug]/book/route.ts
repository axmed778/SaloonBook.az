import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import {
  createBooking,
  SlotTakenError,
  SlotUnavailableError,
  PlanLimitError,
  MAX_BOOKING_AHEAD_DAYS,
} from "@/lib/booking";
import { rateLimit, consumeOutboundQuota, clientIp } from "@/lib/ratelimit";
import { verifyTurnstile } from "@/lib/turnstile";

export const dynamic = "force-dynamic";

// Abuse-protection tuning. The public endpoint is unauthenticated and triggers
// outbound WhatsApp sends to a client-supplied phone, so it is both a spam and a
// cost/harassment vector — these caps bound the blast radius. Redis-backed.
const LIMITS = {
  ip: { limit: 10, windowSec: 600 }, // 10 booking attempts / 10 min / IP
  phone: { limit: 5, windowSec: 3600 }, // 5 attempts / hour / phone
  salon: { limit: 60, windowSec: 600 }, // 60 attempts / 10 min / salon
  // Hard cap on outbound notifications targeting one phone (each booking sends
  // it a confirmation + a reminder). Consumed only on a successful booking.
  outboundPerPhone: { max: 10, windowSec: 86_400 },
} as const;

const bodySchema = z.object({
  serviceId: z.string().uuid(),
  employeeId: z.string().uuid(),
  startUtc: z.string().datetime(), // ISO instant from the availability response
  name: z
    .string()
    .min(1)
    .max(120)
    // Require at least one letter or digit so a name can't be only whitespace
    // or control characters (which sanitization would reduce to empty).
    .regex(/[\p{L}\p{N}]/u, "Name must contain a letter or number"),
  phone: z
    .string()
    .regex(/^\+994\d{9}$/, "Phone must be in +994XXXXXXXXX format"),
  waOptIn: z.boolean().optional(),
  // CAPTCHA: Cloudflare Turnstile token from the public form. Required only when
  // TURNSTILE_SECRET_KEY is configured (see src/lib/turnstile.ts).
  turnstileToken: z.string().max(2048).optional(),
});

function tooMany(resetSec: number, message: string) {
  return NextResponse.json(
    { error: message },
    { status: 429, headers: { "Retry-After": String(resetSec) } },
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const ip = clientIp(req);

  // 1) IP rate limit first — shed obvious abuse before doing any DB work.
  const ipRl = await rateLimit(`book:ip:${ip}`, LIMITS.ip.limit, LIMITS.ip.windowSec);
  if (!ipRl.allowed) return tooMany(ipRl.resetSec, "Too many requests. Please slow down.");

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }

  // Booking horizon: reject dates beyond the public window (mirrors the
  // reschedule cap) so a hostile caller can't stuff a calendar months out.
  const startUtc = new Date(parsed.data.startUtc);
  if (startUtc.getTime() > Date.now() + MAX_BOOKING_AHEAD_DAYS * 86_400_000) {
    return NextResponse.json(
      { error: "That date is too far ahead.", code: "TOO_FAR" },
      { status: 400 },
    );
  }

  // 2) CAPTCHA / Turnstile (no-op unless TURNSTILE_SECRET_KEY is set).
  const captchaOk = await verifyTurnstile(parsed.data.turnstileToken, ip);
  if (!captchaOk) {
    return NextResponse.json({ error: "Captcha verification failed" }, { status: 403 });
  }

  const salon = await prisma.salon.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!salon || salon.status !== "ACTIVE") {
    return NextResponse.json({ error: "Salon not found" }, { status: 404 });
  }

  // 3) Per-phone and per-salon limits.
  const phoneRl = await rateLimit(
    `book:phone:${parsed.data.phone}`,
    LIMITS.phone.limit,
    LIMITS.phone.windowSec,
  );
  if (!phoneRl.allowed) {
    return tooMany(phoneRl.resetSec, "Too many bookings for this phone. Try again later.");
  }
  const salonRl = await rateLimit(
    `book:salon:${salon.id}`,
    LIMITS.salon.limit,
    LIMITS.salon.windowSec,
  );
  if (!salonRl.allowed) {
    return tooMany(salonRl.resetSec, "This salon is receiving too many requests. Try again later.");
  }

  // Confirm the employee can perform the service, in this salon.
  const link = await prisma.serviceEmployee.findFirst({
    where: {
      serviceId: parsed.data.serviceId,
      employeeId: parsed.data.employeeId,
      service: { salonId: salon.id, isActive: true },
      employee: { salonId: salon.id, isActive: true },
    },
    select: { serviceId: true },
  });
  if (!link) {
    return NextResponse.json({ error: "This employee can't perform that service" }, { status: 400 });
  }

  // 4) Outbound notification hard cap for this phone. Consume a permit before
  // booking; if the cap is reached, refuse so we never spam a single number.
  const outboundOk = await consumeOutboundQuota(
    parsed.data.phone,
    LIMITS.outboundPerPhone.max,
    LIMITS.outboundPerPhone.windowSec,
  );
  if (!outboundOk) {
    return tooMany(
      LIMITS.outboundPerPhone.windowSec,
      "This phone has reached its notification limit for now.",
    );
  }

  try {
    const result = await createBooking({
      salonId: salon.id,
      serviceId: parsed.data.serviceId,
      employeeId: parsed.data.employeeId,
      startUtc,
      customer: { name: parsed.data.name, phone: parsed.data.phone, waOptIn: parsed.data.waOptIn },
      source: "PUBLIC",
    });
    const appUrl = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
    return NextResponse.json({
      ok: true,
      appointmentId: result.appointmentId,
      startUtc: result.startUtc.toISOString(),
      // Self-service page: view / cancel / reschedule this appointment.
      manageUrl: `${appUrl}/a/${result.manageToken}`,
    });
  } catch (e) {
    if (e instanceof SlotTakenError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof SlotUnavailableError) {
      return NextResponse.json({ error: e.message, code: "SLOT_UNAVAILABLE" }, { status: 409 });
    }
    if (e instanceof PlanLimitError) {
      return NextResponse.json({ error: e.message, code: "PLAN_LIMIT" }, { status: 402 });
    }
    console.error("[book] error", e);
    return NextResponse.json({ error: "Could not create booking" }, { status: 500 });
  }
}

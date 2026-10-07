import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Register (POST) or remove (DELETE) the App Store app's APNs device token for
// the signed-in owner/staff. Stored as a PushSubscription row with platform
// "ios" so the worker and every salon/user delete path already cover it.
// An APNs token is a hex string (32 bytes today; Apple may lengthen it).
const schema = z.object({
  token: z
    .string()
    .regex(/^[0-9a-fA-F]{64,200}$/)
    .transform((t) => t.toLowerCase()),
});

async function parse(req: NextRequest) {
  const json = await req.json().catch(() => null);
  return schema.safeParse(json);
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session?.salonId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rl = await rateLimit(`push:sub:${session.user.id}`, 30, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } },
    );
  }

  const parsed = await parse(req);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const endpoint = `apns:${parsed.data.token}`;
  const userAgent = req.headers.get("user-agent")?.slice(0, 256) ?? null;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: session.user.id,
      salonId: session.salonId,
      platform: "ios",
      endpoint,
      p256dh: "",
      auth: "",
      userAgent,
    },
    update: {
      // A phone can move between users/branches — refresh ownership.
      userId: session.user.id,
      salonId: session.salonId,
      userAgent,
      lastSeenAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = await parse(req);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  // Scoped to the caller so one user can't remove another's device.
  await prisma.pushSubscription.deleteMany({
    where: { endpoint: `apns:${parsed.data.token}`, userId: session.user.id },
  });

  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Register (or refresh) a Web Push subscription for the signed-in owner/staff's
// current device. Keyed by endpoint; a re-subscribe on the same device updates
// the keys + ownership rather than creating a duplicate.
const schema = z.object({
  endpoint: z.string().url().max(2048),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
});

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

  const json = await req.json().catch(() => null);
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { endpoint, keys } = parsed.data;
  const userAgent = req.headers.get("user-agent")?.slice(0, 256) ?? null;

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    create: {
      userId: session.user.id,
      salonId: session.salonId,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
    },
    update: {
      // A device can move between users/branches — refresh ownership + keys.
      userId: session.user.id,
      salonId: session.salonId,
      p256dh: keys.p256dh,
      auth: keys.auth,
      userAgent,
      lastSeenAt: new Date(),
    },
  });

  return NextResponse.json({ ok: true });
}

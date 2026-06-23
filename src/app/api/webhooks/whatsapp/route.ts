import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

// Meta verification handshake (GET).
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// Delivery/status callbacks (POST). Map provider message ids back to our
// Notification rows. Always 200 fast so Meta doesn't retry.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const statuses =
      body?.entry?.flatMap(
        (e: { changes?: Array<{ value?: { statuses?: unknown[] } }> }) =>
          e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? [],
      ) ?? [];

    for (const s of statuses as Array<{ id?: string; status?: string }>) {
      if (!s.id || !s.status) continue;
      const mapped =
        s.status === "delivered"
          ? "DELIVERED"
          : s.status === "read"
            ? "READ"
            : s.status === "failed"
              ? "FAILED"
              : null;
      if (!mapped) continue;

      await prisma.notification.updateMany({
        where: { providerMsgId: s.id },
        data: { status: mapped },
      });
    }
  } catch (e) {
    console.error("[whatsapp:webhook] error", e);
  }

  return NextResponse.json({ received: true });
}

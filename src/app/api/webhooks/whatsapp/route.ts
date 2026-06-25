import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

/**
 * Verifies Meta's X-Hub-Signature-256 HMAC over the RAW request body using
 * WHATSAPP_APP_SECRET. Returns true to proceed, false to reject.
 *
 * If WHATSAPP_APP_SECRET is unset (local dev / sandbox), verification is skipped
 * so the flow stays usable; production startup warns about the missing secret
 * (see src/lib/env.ts).
 */
function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    console.warn("[whatsapp:webhook] WHATSAPP_APP_SECRET unset — skipping signature check");
    return true;
  }
  if (!header || !header.startsWith("sha256=")) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const provided = header.slice("sha256=".length);

  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(provided, "hex");
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}

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
  // Read the RAW body first — the HMAC must be computed over the exact bytes
  // Meta signed, not a re-serialized JSON object.
  const rawBody = await req.text();
  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);
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

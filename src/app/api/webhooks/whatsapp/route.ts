import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import type { NotifStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { salonForPhoneNumberId } from "@/lib/whatsapp-sender";

export const dynamic = "force-dynamic";

// Meta delivery status -> our NotificationStatus, with the set of prior states
// the transition may advance FROM. A callback whose row is already in a later
// state (e.g. "delivered" arriving after "read") matches nothing and is a no-op.
const STATUS_MAP: Record<string, { to: NotifStatus; from: NotifStatus[] }> = {
  delivered: { to: "DELIVERED", from: ["QUEUED", "SENT"] },
  read: { to: "READ", from: ["QUEUED", "SENT", "DELIVERED"] },
  failed: { to: "FAILED", from: ["QUEUED", "SENT"] },
};

// Customer opt-out keywords (EN + AZ + RU). An inbound message whose text is (or
// begins with) one of these flips the customer to waOptIn=false. Liberal on
// purpose: honoring a STOP too eagerly is safe; missing one damages the number's
// WhatsApp quality rating and breaches Meta policy.
const OPT_OUT_WORDS = ["stop", "unsubscribe", "dayan", "ləğv", "imtina", "стоп", "отписаться"];
function isOptOut(body: string): boolean {
  const t = body.trim().toLowerCase().replace(/[.!?,]+$/, "");
  if (!t) return false;
  return OPT_OUT_WORDS.some((w) => t === w || t.startsWith(`${w} `));
}

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

    // Iterate changes (not a flat status list) so we keep each change's
    // metadata.phone_number_id — the number the callback is FOR. With per-salon
    // own numbers, this lets us scope the update to the owning salon; the wamid
    // (providerMsgId) is globally unique on its own, so this is a tightening, not
    // a correctness dependency (platform-number sends resolve to no salon and
    // match by wamid alone, exactly as before).
    const changes =
      body?.entry?.flatMap(
        (e: { changes?: unknown[] }) => e.changes ?? [],
      ) ?? [];

    for (const c of changes as Array<{
      value?: {
        statuses?: unknown[];
        messages?: unknown[];
        metadata?: { phone_number_id?: string };
      };
    }>) {
      // Inbound customer messages: honor STOP / opt-out keywords. A customer who
      // texts "STOP" (or "dayan"/"ləğv"/"стоп") must never be messaged again.
      // Global by phone — one opt-out silences that number across every salon.
      for (const m of (c.value?.messages ?? []) as Array<{
        from?: string;
        type?: string;
        text?: { body?: string };
        button?: { text?: string };
      }>) {
        const body = m.text?.body ?? m.button?.text ?? "";
        if (!m.from || !isOptOut(body)) continue;
        // Meta sends `from` as bare digits (e.g. "994501234567"); our Customer
        // phones are stored E.164 with a leading "+".
        const phone = m.from.startsWith("+") ? m.from : `+${m.from}`;
        const res = await prisma.customer.updateMany({
          where: { phone, waOptIn: true },
          data: { waOptIn: false },
        });
        if (res.count > 0) {
          console.log(`[whatsapp:webhook] opt-out honored for ${phone} (${res.count} record(s))`);
        }
      }

      const statuses = c.value?.statuses ?? [];
      if (statuses.length === 0) continue;

      const phoneNumberId = c.value?.metadata?.phone_number_id;
      const salonId = phoneNumberId ? await salonForPhoneNumberId(phoneNumberId) : null;

      for (const s of statuses as Array<{ id?: string; status?: string }>) {
        if (!s.id || !s.status) continue;
        const target = STATUS_MAP[s.status];
        if (!target) continue;

        // Monotonic guard: Meta callbacks can arrive out of order (a late
        // "delivered" after "read"). Only advance forward in the lifecycle
        // QUEUED -> SENT -> DELIVERED -> READ, and never let a late "failed"
        // undo a message already delivered/read. The status filter makes this
        // atomic — a stale callback simply matches zero rows. When the number
        // maps to a salon we also scope by salonId (defense in depth).
        const res = await prisma.notification.updateMany({
          where: {
            providerMsgId: s.id,
            status: { in: target.from },
            ...(salonId ? { salonId } : {}),
          },
          data: { status: target.to },
        });

        // If the salon scope matched nothing, the wamid still uniquely
        // identifies the row — fall back to wamid-only so a number that was
        // reassigned across salons between send and callback can't strand a
        // legitimate status update. (No-op when nothing genuinely matches.)
        if (salonId && res.count === 0) {
          await prisma.notification.updateMany({
            where: { providerMsgId: s.id, status: { in: target.from } },
            data: { status: target.to },
          });
        }
      }
    }
  } catch (e) {
    console.error("[whatsapp:webhook] error", e);
  }

  return NextResponse.json({ received: true });
}

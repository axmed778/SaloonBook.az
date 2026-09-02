// Instagram Direct webhook (Instagram API with Instagram Login).
//
// Meta POSTs every DM here — inbound from a lead, and an "echo" of everything
// the salon sends from the Instagram app itself, which is what lets the stored
// thread stay complete without us being the only sender.
//
// Two hard rules from Meta shape this handler:
//   1. The signature is over the RAW bytes, so the body is read as text and
//      parsed only after the HMAC checks out.
//   2. A delivery that is not 200'd within a few seconds is retried, and enough
//      retries get the subscription throttled. So the response is unconditional
//      and prompt; anything that could be slow (a Graph profile lookup) goes to
//      the queue.
//
// A third rule is ours: an unrecognised event shape is skipped, never thrown on
// (see src/lib/ig-events.ts). Meta ships new event types — reactions, read
// receipts, unsends — into the same envelope without warning, and a handler
// that 500s on one of them turns a cosmetic surprise into a retry storm.

import { NextRequest, NextResponse } from "next/server";
import { igSelfId, verifyIgSignature } from "@/lib/instagram";
import { parseIgWebhook } from "@/lib/ig-events";
import { recordIgMessage } from "@/lib/ig-store";
import { bestEffortEnqueue, enqueueIgProfile } from "@/lib/queue";

// Signature verification needs node:crypto and every path here writes to
// Postgres through Prisma — neither survives the edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * How long the handler waits for its own database writes before answering Meta
 * anyway. Work still in flight is NOT cancelled — it finishes in the background
 * on this long-lived Node process — and every write is keyed by mid, so the
 * retry Meta sends after a slow response converges on the same rows instead of
 * duplicating them.
 */
const WEBHOOK_BUDGET_MS = 3_000;

/** Meta verification handshake. The challenge must come back as bare text. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  const expected = process.env.IG_VERIFY_TOKEN;

  if (mode === "subscribe" && expected && token === expected) {
    // Plain text, no JSON, no quotes — Meta compares the body byte for byte and
    // a JSON-encoded challenge fails verification with no useful error.
    return new NextResponse(challenge ?? "", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(req: NextRequest) {
  // RAW body first: the HMAC is over the exact bytes Meta signed, and
  // re-serializing a parsed object would change them.
  const rawBody = await req.text();
  if (!verifyIgSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // Signed but unparseable. Nothing to do, and nothing a retry would fix.
    console.warn("[ig:webhook] signed body was not JSON — ignoring");
    return ok();
  }

  const work = handleEvents(body).catch((e) => {
    console.error("[ig:webhook] processing failed", e);
  });

  await withBudget(work, WEBHOOK_BUDGET_MS);
  return ok();
}

function ok(): NextResponse {
  return new NextResponse("EVENT_RECEIVED", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

/**
 * Wait for `work`, but never longer than `ms`. Resolves either way; the caller
 * responds regardless. The timer is cleared on the fast path so a finished
 * request leaves nothing pending behind it.
 */
async function withBudget(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([work.then(() => undefined), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handleEvents(body: unknown): Promise<void> {
  const events = parseIgWebhook(body, igSelfId());
  let stored = 0;

  // Sequential on purpose: a batch is a handful of events, and two concurrent
  // writes for the same new lead would race on IgThread's unique index for no
  // gain worth the contention.
  for (const ev of events) {
    const { created } = await recordIgMessage(ev);
    if (created) stored++;

    // Inbound only: an echo is our own send, and we already know who we are.
    // Best-effort because a Redis outage must not cost us the message we just
    // persisted — the @handle is a nicety, the conversation is the record.
    if (!ev.fromMe) {
      await bestEffortEnqueue("ig:webhook", () => enqueueIgProfile(ev.igUserId));
    }
  }

  // Counts only. Message bodies never reach the logs.
  if (events.length > 0) {
    console.log(`[ig:webhook] events=${events.length} stored=${stored}`);
  }
}

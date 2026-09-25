import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { sendWhatsAppTemplate } from "../../src/lib/whatsapp";
import { captureError } from "../../src/lib/observability";
import { withDbRetry } from "../../src/lib/db-retry";
import {
  IG_DIGEST_MESSAGES_PER_THREAD,
  IG_DIGEST_MODEL,
  IG_DIGEST_PATH,
  IG_DIGEST_TEMPLATE,
  IG_DIGEST_WINDOW_DAYS,
  buildDigestItems,
  buildDigestPrompt,
  buildDigestSystemPrompt,
  digestTemplateComponents,
  parseDigestResponse,
  type IgDigestThread,
} from "../../src/lib/ig-digest";
import { loadDmPlaybook } from "../playbook";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

/**
 * The daily Direct digest: load the last month's conversations, have Claude
 * triage them in one request, store the result, then ping the founder on
 * WhatsApp with the count and a link.
 *
 * Never throws. A failed day is not worth a retry storm or a crashed worker —
 * the page simply keeps showing yesterday's digest — so every failure is logged
 * (and reported, when Sentry/the alert webhook is configured) and the job
 * completes. No WhatsApp message goes out for a day that produced no digest.
 *
 * Every path through this function logs exactly one "start" line and one "done"
 * or "failed" line. That bracketing is the point: until it existed, the earliest
 * trace of a run was the line written AFTER the Claude call — on 2026-09-25 that
 * was 06:06 for a job scheduled at 05:50, because triaging ~80 threads in one
 * request takes minutes. Looking at 05:50 therefore showed nothing at all for a
 * job that had in fact started and would go on to succeed, which made "the
 * scheduler never fired" and "the digest is still thinking" indistinguishable.
 */
export async function runIgDigest(now: Date = new Date()): Promise<void> {
  console.log("[ig-digest] start");

  let saved: { id: string; count: number } | null;
  try {
    saved = await generateIgDigest(now);
  } catch (e) {
    logFailure("generate", e);
    return;
  }
  if (!saved) {
    console.log("[ig-digest] done, skipped (no digest generated)");
    return;
  }

  try {
    await notifyDigest(saved.count);
  } catch (e) {
    // The digest is already saved and visible; only the nudge was lost.
    logFailure("notify", e);
  }
  console.log(`[ig-digest] done, ${saved.count} items`);
}

async function generateIgDigest(now: Date): Promise<{ id: string; count: number } | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.warn("[ig-digest] ANTHROPIC_API_KEY is unset — skipping today's digest");
    return null;
  }

  // The first database touch of the day's run, and so the one that meets a
  // suspended Neon compute: it autosuspends after five idle minutes, and the
  // query that wakes it fails outright ("Can't reach database server") rather
  // than waiting. A scheduled job is by definition what arrives after an idle
  // stretch, and a day lost that way is not retried at all, since runIgDigest
  // deliberately never throws and the scheduler fires only once a day.
  // Retrying only the read is safe (both queries inside are selects), and once it
  // succeeds the compute is awake for the write that follows.
  const threads = await withDbRetry("ig-digest", () => loadThreads(now));

  let items: ReturnType<typeof buildDigestItems> = [];
  if (threads.length > 0) {
    // Read before the request, and allowed to throw: a digest whose drafts did
    // not come from the playbook is worse than no digest (see worker/playbook.ts).
    const playbook = loadDmPlaybook();
    const text = await askClaude(buildDigestSystemPrompt(playbook), buildDigestPrompt(threads, now));
    const { verdicts, rejected } = parseDigestResponse(text);
    if (rejected > 0) {
      console.warn(`[ig-digest] dropped ${rejected} malformed item(s) from the answer`);
    }
    items = buildDigestItems(verdicts, threads, now);
  }

  // A quiet month still gets a row: "nothing to do today" is an answer, and
  // leaving last week's list up would present it as today's.
  const digest = await prisma.igDigest.create({
    data: { items: items as unknown as Prisma.InputJsonValue },
    select: { id: true },
  });
  console.log(
    `[ig-digest] digest ${digest.id}: ${items.length} task(s) from ${threads.length} thread(s)`,
  );
  return { id: digest.id, count: items.length };
}

async function loadThreads(now: Date): Promise<IgDigestThread[]> {
  const since = new Date(now.getTime() - IG_DIGEST_WINDOW_DAYS * 86_400_000);
  const rows = await prisma.igThread.findMany({
    where: { lastMessageAt: { gte: since } },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      igUserId: true,
      username: true,
      name: true,
      // Newest N, reversed below: "the last 12, in chronological order".
      messages: {
        orderBy: { sentAt: "desc" },
        take: IG_DIGEST_MESSAGES_PER_THREAD,
        // sentAt drives daysAwaitingLead: when the last message is mine, its
        // timestamp is when the follow-up clock started.
        select: { fromMe: true, text: true, attach: true, sentAt: true },
      },
    },
  });

  // The lead's last message across the whole thread, one query for all of
  // them: the tail above can be twelve of our own follow-ups, and a lead that
  // quiet is exactly the one daysIdle exists to surface.
  const leadLast = await prisma.igMessage.groupBy({
    by: ["threadId"],
    where: { threadId: { in: rows.map((r) => r.id) }, fromMe: false },
    _max: { sentAt: true },
  });
  const leadLastAt = new Map(leadLast.map((g) => [g.threadId, g._max.sentAt]));

  return rows.flatMap((r) =>
    r.messages.length > 0
      ? [
          {
            igUserId: r.igUserId,
            username: r.username,
            name: r.name,
            lastLeadMessageAt: leadLastAt.get(r.id) ?? null,
            messages: [...r.messages].reverse(),
          },
        ]
      : [],
  );
}

/**
 * One request, every thread in it. Streamed because the answer carries a draft
 * per lead and can run long; finalMessage() just collects it. Anything but a
 * natural end — hitting max_tokens mid-array, a refusal — is a failed run: a
 * truncated array would silently lose the leads at its tail.
 */
async function askClaude(system: string, prompt: string): Promise<string> {
  const client = new Anthropic();
  const message = await client.messages
    .stream({
      model: IG_DIGEST_MODEL,
      max_tokens: 64_000,
      thinking: { type: "adaptive" },
      system,
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();

  if (message.stop_reason !== "end_turn") {
    throw new Error(`Claude stopped with stop_reason=${message.stop_reason}`);
  }
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("");
}

async function notifyDigest(count: number): Promise<void> {
  const phone = process.env.DIGEST_PHONE?.trim();
  if (!phone) {
    console.warn("[ig-digest] DIGEST_PHONE is unset — digest saved, no WhatsApp sent");
    return;
  }
  const result = await sendWhatsAppTemplate({
    toPhone: phone,
    template: IG_DIGEST_TEMPLATE,
    languageCode: "az",
    components: digestTemplateComponents(count, `${APP_URL}${IG_DIGEST_PATH}`),
  });
  if (!result.sandbox) console.log("[ig-digest] WhatsApp notice sent");
}

function logFailure(stage: "generate" | "notify", e: unknown): void {
  // Status first when it's an API error: 401 (bad key), 429 and 529 (overloaded)
  // each call for something different, and the message alone buries it.
  const detail =
    e instanceof Anthropic.APIError
      ? `Anthropic API ${e.status ?? "connection"} error: ${e.message}`
      : e instanceof Error
        ? e.message
        : String(e);
  // Reads as "[ig-digest] failed: …" so it pairs with the "start" line above and
  // one grep for `[ig-digest]` shows a run's whole outcome; the stage says which
  // half of the job died, which matters because a failed `notify` still leaves a
  // saved, visible digest behind.
  console.error(`[ig-digest] failed: ${stage} — ${detail}`);
  void captureError(e, {
    source: "worker",
    level: "warning",
    tags: { kind: "ig-digest", stage },
  });
}

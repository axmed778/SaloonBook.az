import Anthropic from "@anthropic-ai/sdk";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { sendWhatsAppTemplate } from "../../src/lib/whatsapp";
import { captureError } from "../../src/lib/observability";
import {
  IG_DIGEST_MESSAGES_PER_THREAD,
  IG_DIGEST_MODEL,
  IG_DIGEST_PATH,
  IG_DIGEST_SYSTEM_PROMPT,
  IG_DIGEST_TEMPLATE,
  IG_DIGEST_WINDOW_DAYS,
  buildDigestItems,
  buildDigestPrompt,
  digestTemplateComponents,
  parseDigestResponse,
  type IgDigestThread,
} from "../../src/lib/ig-digest";

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
 */
export async function runIgDigest(now: Date = new Date()): Promise<void> {
  let saved: { id: string; count: number } | null;
  try {
    saved = await generateIgDigest(now);
  } catch (e) {
    logFailure("generate", e);
    return;
  }
  if (!saved) return;

  try {
    await notifyDigest(saved.count);
  } catch (e) {
    // The digest is already saved and visible; only the nudge was lost.
    logFailure("notify", e);
  }
}

async function generateIgDigest(now: Date): Promise<{ id: string; count: number } | null> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) {
    console.warn("[worker:ig-digest] ANTHROPIC_API_KEY is unset — skipping today's digest");
    return null;
  }

  const threads = await loadThreads(now);

  let items: ReturnType<typeof buildDigestItems> = [];
  if (threads.length > 0) {
    const text = await askClaude(buildDigestPrompt(threads, now));
    const { verdicts, rejected } = parseDigestResponse(text);
    if (rejected > 0) {
      console.warn(`[worker:ig-digest] dropped ${rejected} malformed item(s) from the answer`);
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
    `[worker:ig-digest] digest ${digest.id}: ${items.length} task(s) from ${threads.length} thread(s)`,
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
        select: { fromMe: true, text: true, attach: true },
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
async function askClaude(prompt: string): Promise<string> {
  const client = new Anthropic();
  const message = await client.messages
    .stream({
      model: IG_DIGEST_MODEL,
      max_tokens: 64_000,
      thinking: { type: "adaptive" },
      system: IG_DIGEST_SYSTEM_PROMPT,
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
    console.warn("[worker:ig-digest] DIGEST_PHONE is unset — digest saved, no WhatsApp sent");
    return;
  }
  const result = await sendWhatsAppTemplate({
    toPhone: phone,
    template: IG_DIGEST_TEMPLATE,
    languageCode: "az",
    components: digestTemplateComponents(count, `${APP_URL}${IG_DIGEST_PATH}`),
  });
  if (!result.sandbox) console.log("[worker:ig-digest] WhatsApp notice sent");
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
  console.error(`[worker:ig-digest] ${stage} failed — ${detail}`);
  void captureError(e, {
    source: "worker",
    level: "warning",
    tags: { kind: "ig-digest", stage },
  });
}

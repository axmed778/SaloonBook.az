// Daily Instagram Direct digest: the pure half.
//
// Everything here is side-effect free — no Prisma, no Anthropic SDK, no queue —
// so the prompt shape, the parser and the ordering can be unit-tested without a
// database or an API key (ig-digest.test.ts), and so the dashboard page can
// import the item type without pulling the SDK into the web bundle. The worker
// (worker/processors/ig-digest.ts) does the I/O around it.

import { z } from "zod";
import type { Prisma } from "@prisma/client";

/** Pinned by request. One call a day, so cost is not the deciding factor. */
export const IG_DIGEST_MODEL = "claude-sonnet-4-6";

/** Threads with any message in this many days make it into the digest. */
export const IG_DIGEST_WINDOW_DAYS = 30;

/** How much of each conversation Claude sees — the tail, oldest first. */
export const IG_DIGEST_MESSAGES_PER_THREAD = 12;

/**
 * Meta-approved WhatsApp template sent to DIGEST_PHONE once the digest is saved.
 * Body: {{1}} number of tasks, {{2}} link to the page. See
 * docs/whatsapp-templates.md — the parameter order here must match it.
 */
export const IG_DIGEST_TEMPLATE = "ig_digest_ready";

export const IG_DIGEST_PATH = "/dashboard/ig-digest";

export const IG_DIGEST_SYSTEM_PROMPT = `Ты — ассистент основателя SalonBook.az, SaaS для салонов красоты
в Азербайджане. Продукт организует существующие записи, НЕ приводит
новых клиентов. Тарифы: Start 15₼, Salon 35₼, Pro 70₼ в месяц,
14 дней бесплатно.

На входе — переписки из Instagram Direct. Для каждой определи:
- priority: hot / warm / cold / skip
- reason: одна строка по-русски, что происходит в диалоге
- action: одна строка, что конкретно сделать
- draft: готовый текст сообщения на азербайджанском, максимум 4 строки,
  обязательно заканчивается вопросом

Правила для draft:
- короткие, живые, без канцелярита и без давления
- не перечислять все три тарифа: спросить о салоне, цену называть
  под конкретный случай
- никогда не заканчивать утверждением или "Aydındırmı?"
- если лид задал вопрос без ответа — сначала ответить на него

priority = skip, если диалог явно закрыт, это спам или личное.

У каждой переписки в заголовке есть daysIdle — сколько дней молчит лид
(null — лид ещё не писал) и daysSinceMyReply — сколько дней лид ждёт ответа.
daysSinceMyReply > 0 означает, что лид написал последним и ждёт
ответа — такие треды почти всегда priority = hot.

Верни ТОЛЬКО JSON-массив, без markdown и без пояснений.`;

export const IG_DIGEST_PRIORITIES = ["hot", "warm", "cold", "skip"] as const;
export type IgDigestPriority = (typeof IG_DIGEST_PRIORITIES)[number];
/** What survives into a stored digest: "skip" is dropped before saving. */
export type IgDigestShownPriority = Exclude<IgDigestPriority, "skip">;

/** One entry of IgDigest.items. */
export interface IgDigestItem {
  igUserId: string;
  username: string | null;
  /** Display name, for the page. Snapshotted so a later profile fill can't reshuffle history. */
  name: string | null;
  /** Whole days since the LEAD last wrote; null when they never have. */
  daysIdle: number | null;
  /**
   * Whole days the lead's last message has gone unanswered — 0 when the last
   * message in the thread is ours. Never 0 while the lead is waiting (see
   * idleStats), so "> 0" reads as "the ball is in my court".
   */
  daysSinceMyReply: number;
  priority: IgDigestShownPriority;
  reason: string;
  action: string;
  draft: string;
  done: boolean;
}

/** A conversation as the worker loads it, messages oldest first. */
export interface IgDigestThread {
  igUserId: string;
  username: string | null;
  name: string | null;
  /**
   * The lead's newest message in the WHOLE thread, not just the tail below: a
   * lead who went quiet more than twelve messages ago still has a date.
   */
  lastLeadMessageAt: Date | null;
  /** The newest messages, oldest first. Non-empty; its last entry is the thread's last message. */
  messages: Array<{ fromMe: boolean; text: string | null; attach: Prisma.JsonValue | null }>;
}

const DAY_MS = 86_400_000;

function wholeDays(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS));
}

/**
 * The two idle counters, both from our own timestamps, never from the model.
 *
 * daysIdle is measured from the LEAD's last message. Measuring from the last
 * message by either side — the first version — reset the clock on our own
 * follow-up, which hid exactly the conversations that die: we wrote, they
 * didn't answer.
 *
 * daysSinceMyReply is floored at 1 while the lead is waiting. Whole-day
 * rounding would otherwise report a message that arrived overnight — the
 * likeliest thing to be waiting at 09:50 — as 0, indistinguishable from "I
 * replied", and it would miss both the waiting-first sort and the prompt's
 * "> 0 means hot" rule.
 */
export function idleStats(
  thread: Pick<IgDigestThread, "lastLeadMessageAt" | "messages">,
  now: Date,
): { daysIdle: number | null; daysSinceMyReply: number } {
  const lead = thread.lastLeadMessageAt;
  const daysIdle = lead ? wholeDays(lead, now) : null;
  const leadWroteLast = thread.messages.at(-1)?.fromMe === false;
  const daysSinceMyReply = leadWroteLast && lead ? Math.max(1, wholeDays(lead, now)) : 0;
  return { daysIdle, daysSinceMyReply };
}

/**
 * "ME: …" / "LEAD: …", one line per message. Newlines inside a message are
 * flattened so a multi-line DM can't pass itself off as a second speaker, and a
 * message with no text (a photo, a story reply, a voice note) still shows up —
 * leaving it out would hide that the lead answered at all.
 */
export function formatTranscript(messages: IgDigestThread["messages"]): string {
  return messages
    .map((m) => {
      const text = m.text?.replace(/\s+/g, " ").trim() || (m.attach ? "[вложение]" : "[пусто]");
      return `${m.fromMe ? "ME" : "LEAD"}: ${text}`;
    })
    .join("\n");
}

/**
 * The single user message: every thread under a header carrying its igUserId,
 * which is how an answer is matched back to a lead. The system prompt is the
 * founder's text verbatim; the field list for the answer lives here instead, so
 * the two can be edited independently.
 */
export function buildDigestPrompt(threads: IgDigestThread[], now: Date): string {
  const blocks = threads.map((t) => {
    const who = [t.username ? `@${t.username}` : null, t.name].filter(Boolean).join(" · ");
    const { daysIdle, daysSinceMyReply } = idleStats(t, now);
    const header =
      `### igUserId: ${t.igUserId}` +
      (who ? ` | ${who}` : "") +
      ` | daysIdle: ${daysIdle ?? "null"} | daysSinceMyReply: ${daysSinceMyReply}`;
    return `${header}\n${formatTranscript(t.messages)}`;
  });

  return (
    `Переписок: ${threads.length}. Для каждой верни объект ` +
    `{"igUserId", "priority", "reason", "action", "draft"}, ` +
    `где igUserId скопирован из заголовка переписки без изменений.\n\n` +
    blocks.join("\n\n")
  );
}

const verdictSchema = z.object({
  igUserId: z.string().min(1),
  priority: z.enum(IG_DIGEST_PRIORITIES),
  reason: z.string(),
  action: z.string(),
  draft: z.string(),
});
export type IgDigestVerdict = z.infer<typeof verdictSchema>;

export interface ParsedDigest {
  verdicts: IgDigestVerdict[];
  /** Array entries that didn't match the expected shape and were dropped. */
  rejected: number;
}

/**
 * Parse Claude's answer. Throws when it isn't a JSON array at all — that is a
 * failed run, and the caller keeps yesterday's digest. A malformed ENTRY only
 * costs that one lead, so it is dropped and counted rather than sinking the rest.
 *
 * Tolerates a ```json fence even though the prompt forbids one: refusing a
 * perfectly good answer over its wrapping would be the worse failure.
 */
export function parseDigestResponse(text: string): ParsedDigest {
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end < start) throw new Error("no JSON array in the response");

  const raw: unknown = JSON.parse(text.slice(start, end + 1));
  if (!Array.isArray(raw)) throw new Error("response is not a JSON array");

  const verdicts: IgDigestVerdict[] = [];
  let rejected = 0;
  for (const entry of raw) {
    const parsed = verdictSchema.safeParse(entry);
    if (parsed.success) verdicts.push(parsed.data);
    else rejected += 1;
  }
  return { verdicts, rejected };
}

const PRIORITY_RANK: Record<IgDigestShownPriority, number> = { hot: 0, warm: 1, cold: 2 };

/**
 * Join Claude's verdicts back onto the threads and put them in reading order:
 * every lead waiting on a reply first, then hot → warm → cold. Ties go to the
 * longest wait, then to the lead who wrote most recently (never-wrote last).
 * "skip" is dropped, and
 * so is any igUserId that wasn't in the input — an invented or mangled id can't
 * be acted on and would put a stranger's name on the page. A thread answered
 * twice keeps its first verdict.
 *
 * Names and both idle counters come from the database, never from the model's
 * echo of them: those are facts we already hold.
 */
export function buildDigestItems(
  verdicts: IgDigestVerdict[],
  threads: IgDigestThread[],
  now: Date,
): IgDigestItem[] {
  const byId = new Map(threads.map((t) => [t.igUserId, t]));
  const seen = new Set<string>();
  const items: IgDigestItem[] = [];

  for (const v of verdicts) {
    if (v.priority === "skip") continue;
    const thread = byId.get(v.igUserId);
    if (!thread || seen.has(v.igUserId)) continue;
    seen.add(v.igUserId);
    items.push({
      igUserId: thread.igUserId,
      username: thread.username,
      name: thread.name,
      ...idleStats(thread, now),
      priority: v.priority,
      reason: v.reason.trim(),
      action: v.action.trim(),
      draft: v.draft.trim(),
      done: false,
    });
  }

  const waiting = (i: IgDigestItem) => (i.daysSinceMyReply > 0 ? 0 : 1);
  const idleOrLast = (i: IgDigestItem) => i.daysIdle ?? Number.MAX_SAFE_INTEGER;
  return items.sort(
    (a, b) =>
      waiting(a) - waiting(b) ||
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      b.daysSinceMyReply - a.daysSinceMyReply ||
      idleOrLast(a) - idleOrLast(b),
  );
}

const storedItemSchema = z.object({
  igUserId: z.string(),
  username: z.string().nullable().catch(null),
  name: z.string().nullable().catch(null),
  daysIdle: z.number().nullable(),
  daysSinceMyReply: z.number(),
  priority: z.enum(["hot", "warm", "cold"]),
  reason: z.string(),
  action: z.string(),
  draft: z.string(),
  done: z.boolean().catch(false),
});

/**
 * Read IgDigest.items back for display. Json columns are untyped at the
 * boundary; an entry that doesn't parse is skipped rather than crashing the
 * page. Each item keeps its array index, which is what the "done" toggle
 * addresses.
 */
export function readDigestItems(json: Prisma.JsonValue): Array<IgDigestItem & { index: number }> {
  if (!Array.isArray(json)) return [];
  return json.flatMap((entry, index) => {
    const parsed = storedItemSchema.safeParse(entry);
    return parsed.success ? [{ ...parsed.data, index }] : [];
  });
}

/** WhatsApp body params for IG_DIGEST_TEMPLATE: {{1}} count, {{2}} link. */
export function digestTemplateComponents(count: number, url: string): unknown[] {
  return [
    {
      type: "body",
      parameters: [
        { type: "text", text: String(count) },
        { type: "text", text: url },
      ],
    },
  ];
}

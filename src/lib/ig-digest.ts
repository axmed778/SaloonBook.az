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

/** The exact `action` for a thread whose scenario needs a decision first. */
export const NEEDS_DECISION_ACTION = "нужно ваше решение";

/**
 * The system prompt, with the DM playbook embedded as the single source of truth
 * for drafts.
 *
 * A function rather than a constant because the playbook is a file
 * (docs/dm-playbook.md, read by worker/playbook.ts): keeping the text out of this
 * module is what stops a second, drifting copy of the founder's own document from
 * living in the source.
 *
 * Deliberately NOT here any more, because the playbook already covers them and
 * two sets of rules would contradict each other:
 *   * "максимум 4 строки" — scenario 7.0 is a four-step onboarding message and is
 *     supposed to go out whole.
 *   * "обязательно заканчивается вопросом" — playbook rule 2 says the same but
 *     names the closing exceptions (1.10, 8.4, 9.1, 9.3), which a blanket rule
 *     would break.
 *   * "не перечислять все три тарифа" — section 2.1 names exactly one tariff per
 *     case already.
 *   * "priority = skip, если … это спам или личное" — the spam half is section
 *     9.4 and the non-target half is 1.10, both far more specific; "личное" also
 *     covered offering personal help, which is playbook rules 7 and 11.
 * (There was no separate rule about unnamed accounts to remove — the prompt never
 * had one; 1.10 and 9.4 are what decides those threads now.)
 */
export function buildDigestSystemPrompt(playbook: string): string {
  return `Ты — ассистент основателя SalonBook.az, SaaS для салонов красоты
в Азербайджане. Продукт организует существующие записи, НЕ приводит
новых клиентов.

Ниже — DM PLAYBOOK. Это ЕДИНСТВЕННЫЙ источник истины для черновиков:
тексты, тарифы, факты о продукте и тон берутся только из него. Ничего не
добавляй от себя и не обещай функций, которых в плейбуке нет.

<playbook>
${playbook}
</playbook>

На входе — переписки из Instagram Direct. Для каждой верни:
- priority: hot / warm / cold / skip
- reason: одна строка по-русски, ОБЯЗАТЕЛЬНО начинается с номера
  применённого сценария — например "сценарий 1.7 — вопрос про рекламу"
- action: одна строка по-русски, что конкретно сделать
- draft: готовый текст сообщения лиду

ВЫБОР ЧЕРНОВИКА
draft берётся из подходящего сценария плейбука (1.1–1.13, 2.x–9.x) —
дословно или с минимальной адаптацией под этот диалог (имя, число мастеров,
тариф). Свой текст не сочиняй. Если точного сценария нет, возьми ближайший,
адаптируй и укажи его номер в reason. Язык — язык лида (правило 5): писал
по-русски — отвечай по-русски, иначе по-азербайджански. Вопрос в конце — по
правилу 2, с его исключениями (1.10, 8.4, 9.1, 9.3).

draft — обычный текст для Instagram Direct, а не markdown. Ссылки пиши как
есть: https://salonbook.az/demostudio, без разметки вида [текст](ссылка).

PRIORITY
- skip — спам, боты, "follow me", реклама своих услуг (раздел 9.4);
  нецелевой лид: другая сфера, ищет работу, поставщик, клиентка ищет салон
  (раздел 1.10). Внимание: лазер, косметолог, брови, ресницы — ЦЕЛЕВЫЕ,
  это не skip, отвечай как салону.
- hot — лид ждёт ответа, спрашивает цену, просит ссылку или демо, застрял
  в настройке.
- warm / cold — остальное по температуре интереса.

СЧЁТЧИКИ В ЗАГОЛОВКЕ ПЕРЕПИСКИ
- daysIdle — сколько дней назад лид писал последний раз (null — не писал).
- daysSinceMyReply — сколько дней лид ждёт МОЕГО ответа. > 0 значит, что
  последним писал лид: почти всегда hot, и сначала ответь на его вопрос.
- daysAwaitingLead — сколько дней назад Я написал последним, а лид не
  ответил. > 0 значит, что мяч на стороне лида, и это фоллоу-ап.

ФОЛЛОУ-АП — только когда daysAwaitingLead > 0
- 0 (тот же день, прошло несколько часов) — priority = skip, поднимать рано.
- 1 день — сценарий 8.1
- 2 дня — сценарий 8.2
- 4 дня — сценарий 8.3
- 7 дней — сценарий 8.4, последнее касание.
- 3, 5 или 6 дней (дайджест пропустил день) — возьми последний ЕЩЁ НЕ
  отправленный шаг цепочки 8.1 → 8.2 → 8.3 → 8.4. Шаг, текст которого уже
  виден в переписке, не повторяй.
- больше 7 дней и 8.4 уже отправлено — priority = skip, тред закрыт по
  логике плейбука. Единственное исключение — реактивация 8.5 через 3 недели,
  и только если есть РЕАЛЬНЫЙ повод (новая функция, реальное число салонов).
  Повода нет — skip; не предлагай 8.5 с выдуманным поводом.

ТРИАЛ
Триал длится 14 дней (раздел 0). Сценарии 7.4–7.9 привязаны к дню триала, но
дня триала в этих данных НЕТ: регистрации в SalonBook с перепиской не
связаны. Поэтому бери 7.4–7.9 только если лид сам написал, что
зарегистрировался, и опирайся на его слова. Никогда не подставляй выдуманное
число — ни день триала, ни "[N] gün qalıb".

КВАДРАТНЫЕ СКОБКИ
В плейбуке в скобках два разных вида вставок:
1. Подстановки — [ad], [Имя], [N] usta, [Start/Salon/Pro], [15/35/70].
   Их ЗАПОЛНИ реальным значением из диалога.
2. Нерешённое — [ПРОВЕРЬ], [РЕШИ], [где: ПРОВЕРЬ], [повод],
   [WHATSAPP НОМЕР], [ПРОВЕРЬ: сколько]. Это неподтверждённые факты и
   непринятые решения, выдумывать их нельзя (правило 8 — не врать).
Если в выбранном сценарии осталось нерешённое:
- опусти этот фрагмент фразы, если смысл сценария сохраняется;
- если без него смысл теряется — draft оставь ПУСТОЙ строкой,
  action = "${NEEDS_DECISION_ACTION}", reason — номер сценария и что именно
  не решено, priority = hot.
В готовом draft квадратных скобок быть не должно ни в каком виде.

Верни ТОЛЬКО JSON-массив, без markdown и без пояснений.`;
}

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
  /**
   * The mirror image: whole days since MY last message when mine is the last one
   * in the thread, 0 otherwise. "> 0" reads as "the ball is in the lead's court",
   * which is the only state in which a follow-up (playbook 8.1–8.5) applies, and
   * its value is what picks the step.
   *
   * A separate counter because daysSinceMyReply measures the opposite thing
   * despite its name — it is the lead's wait, and it is 0 for the entire
   * follow-up situation, so the cadence could never have been keyed off it.
   */
  daysAwaitingLead: number;
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
  messages: Array<{
    fromMe: boolean;
    text: string | null;
    attach: Prisma.JsonValue | null;
    /** Needed for daysAwaitingLead: the follow-up clock starts at MY last message. */
    sentAt: Date;
  }>;
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
 *
 * daysAwaitingLead is the opposite case and is NOT floored: the follow-up ladder
 * starts at day 1, and day 0 means "I wrote a few hours ago", which the playbook
 * says is too early to raise. Flooring it would turn every message sent this
 * morning into a day-1 follow-up.
 */
export function idleStats(
  thread: Pick<IgDigestThread, "lastLeadMessageAt" | "messages">,
  now: Date,
): { daysIdle: number | null; daysSinceMyReply: number; daysAwaitingLead: number } {
  const lead = thread.lastLeadMessageAt;
  const daysIdle = lead ? wholeDays(lead, now) : null;
  const last = thread.messages.at(-1);
  const leadWroteLast = last?.fromMe === false;
  const daysSinceMyReply = leadWroteLast && lead ? Math.max(1, wholeDays(lead, now)) : 0;
  // Measured from MY last message, which is the thread's last message in exactly
  // this branch — so no extra query is needed to find when I wrote.
  const daysAwaitingLead = last?.fromMe ? wholeDays(last.sentAt, now) : 0;
  return { daysIdle, daysSinceMyReply, daysAwaitingLead };
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
    const { daysIdle, daysSinceMyReply, daysAwaitingLead } = idleStats(t, now);
    const header =
      `### igUserId: ${t.igUserId}` +
      (who ? ` | ${who}` : "") +
      ` | daysIdle: ${daysIdle ?? "null"} | daysSinceMyReply: ${daysSinceMyReply}` +
      ` | daysAwaitingLead: ${daysAwaitingLead}`;
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

/** A markdown link, as the playbook writes every URL: `[https://x](https://x)`. */
const MARKDOWN_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g;

/**
 * Flatten the playbook's markdown links into bare URLs.
 *
 * Two problems in one. An Instagram DM is plain text, so a draft copied straight
 * out of a scenario would send a salon the literal string
 * "[https://salonbook.az/demostudio](https://salonbook.az/demostudio)". And the
 * bracket guard below would see those brackets as an unresolved placeholder and
 * blank the draft — which, since almost every scenario carries the demo link,
 * would have emptied most of the digest.
 */
export function flattenMarkdownLinks(draft: string): string {
  return draft.replace(MARKDOWN_LINK, (_m, label: string, url: string) =>
    label === url ? url : `${label} ${url}`,
  );
}

/** Anything still in square brackets, e.g. "[где: ПРОВЕРЬ]" or "[N] gün". */
const BRACKETED = /\[[^\]\n]*\]/g;

/**
 * The playbook's own first rule about brackets: "Всё в квадратных скобках клиенту
 * не отправлять." A draft is supposed to arrive with every placeholder either
 * filled in or dropped, so anything left is either an unconfirmed fact
 * ([ПРОВЕРЬ]), an unmade decision ([РЕШИ]) or a substitution the model missed.
 *
 * This is the backstop for all three. The prompt asks for an empty draft in that
 * case, but a draft that reaches the founder with "[где: ПРОВЕРЬ]" in it is one
 * copy-paste away from reaching a salon, so the guarantee is enforced here rather
 * than merely requested.
 */
export function unresolvedPlaceholders(draft: string): string[] {
  return draft.match(BRACKETED) ?? [];
}

/**
 * Join Claude's verdicts back onto the threads and put them in reading order:
 * every lead waiting on a reply first, then hot → warm → cold. Ties go to the
 * longest wait, then to the lead who wrote most recently (never-wrote last).
 * "skip" is dropped, and
 * so is any igUserId that wasn't in the input — an invented or mangled id can't
 * be acted on and would put a stranger's name on the page. A thread answered
 * twice keeps its first verdict.
 *
 * Names and all three idle counters come from the database, never from the
 * model's echo of them: those are facts we already hold.
 *
 * A draft still carrying square brackets is emptied and turned into a decision
 * the founder has to make (see unresolvedPlaceholders): the thread stays in the
 * digest, as hot, with the unresolved fragments named in `reason` — which is
 * strictly more useful than a ready-looking text that must not be sent.
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

    // Links first: a markdown link is brackets too, and every scenario has one.
    const draft = flattenMarkdownLinks(v.draft.trim());
    const leftover = unresolvedPlaceholders(draft);
    const reason = v.reason.trim();
    items.push({
      igUserId: thread.igUserId,
      username: thread.username,
      name: thread.name,
      ...idleStats(thread, now),
      // Unresolved brackets outrank the model's own priority: this is a thread
      // the founder must look at today, whatever its temperature.
      priority: leftover.length > 0 ? "hot" : v.priority,
      reason:
        leftover.length > 0 ? `${reason} — не заполнено: ${leftover.join(" ")}` : reason,
      action: leftover.length > 0 ? NEEDS_DECISION_ACTION : v.action.trim(),
      draft: leftover.length > 0 ? "" : draft,
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
  // Added after the first digests were stored, so old rows have no such field:
  // default to 0 ("not a follow-up") rather than dropping a historical item.
  daysAwaitingLead: z.number().catch(0),
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

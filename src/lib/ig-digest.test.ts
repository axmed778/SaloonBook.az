import { describe, it, expect } from "vitest";
import {
  NEEDS_DECISION_ACTION,
  buildDigestItems,
  buildDigestPrompt,
  buildDigestSystemPrompt,
  digestTemplateComponents,
  flattenMarkdownLinks,
  formatTranscript,
  idleStats,
  parseDigestResponse,
  readDigestItems,
  unresolvedPlaceholders,
  type IgDigestThread,
  type IgDigestVerdict,
} from "./ig-digest";

const NOW = new Date("2026-09-24T05:50:00Z");
const HOUR = 3_600_000;
const daysAgo = (n: number, extraMs = 0) => new Date(NOW.getTime() - n * 86_400_000 - extraMs);

const LEAD_MSG = { fromMe: false, text: "Salam", attach: null, sentAt: daysAgo(1) };
const MY_MSG = { fromMe: true, text: "Salam!", attach: null, sentAt: daysAgo(1) };

/** Our own message, sent `days` ago — the follow-up clock for daysAwaitingLead. */
const myMsgSent = (days: number, extraMs = 0) => ({ ...MY_MSG, sentAt: daysAgo(days, extraMs) });

/** A thread whose lead last wrote `leadDays` ago; by default the lead wrote last. */
function thread(igUserId: string, leadDays: number | null, overrides: Partial<IgDigestThread> = {}): IgDigestThread {
  return {
    igUserId,
    username: `user_${igUserId}`,
    name: `Name ${igUserId}`,
    lastLeadMessageAt: leadDays === null ? null : daysAgo(leadDays),
    messages: [LEAD_MSG],
    ...overrides,
  };
}

/**
 * Same, but our reply is the last message: nobody is waiting on us. Our reply is
 * dated to the lead's own day unless a test needs the follow-up clock elsewhere.
 */
const answered = (igUserId: string, leadDays: number | null) =>
  thread(igUserId, leadDays, {
    messages: [LEAD_MSG, leadDays === null ? MY_MSG : myMsgSent(leadDays)],
  });

function verdict(igUserId: string, priority: IgDigestVerdict["priority"]): IgDigestVerdict {
  return { igUserId, priority, reason: " r ", action: " a ", draft: " d? " };
}

describe("idleStats", () => {
  it("counts daysIdle from the lead's last message, not ours", () => {
    // The lead went quiet 6 days ago; our follow-up must not reset the clock.
    expect(idleStats(answered("x", 6), NOW)).toEqual({
      daysIdle: 6,
      daysSinceMyReply: 0,
      daysAwaitingLead: 6,
    });
  });

  it("is null when the lead never wrote", () => {
    const t = thread("x", null, { messages: [myMsgSent(2)] });
    expect(idleStats(t, NOW)).toEqual({
      daysIdle: null,
      daysSinceMyReply: 0,
      daysAwaitingLead: 2,
    });
  });

  it("counts the wait when the lead wrote last", () => {
    expect(idleStats(thread("x", 3, { lastLeadMessageAt: daysAgo(3, 5 * HOUR) }), NOW)).toEqual({
      daysIdle: 3,
      daysSinceMyReply: 3,
      // The ball is in my court, so there is nothing to follow up on.
      daysAwaitingLead: 0,
    });
  });

  it("reports a same-day unanswered message as 1, never as 0", () => {
    const t = thread("x", 0, { lastLeadMessageAt: new Date(NOW.getTime() - 2 * HOUR) });
    expect(idleStats(t, NOW)).toEqual({
      daysIdle: 0,
      daysSinceMyReply: 1,
      daysAwaitingLead: 0,
    });
  });

  it("counts daysAwaitingLead from MY last message when mine is last", () => {
    // The lead wrote 9 days ago, I followed up 4 days ago: the follow-up ladder
    // is at step 8.3 (day 4), not at day 9.
    const t = thread("x", 9, { messages: [LEAD_MSG, myMsgSent(4)] });
    expect(idleStats(t, NOW)).toMatchObject({ daysIdle: 9, daysAwaitingLead: 4 });
  });

  it("leaves daysAwaitingLead at 0 for a message I sent hours ago", () => {
    // Not floored, unlike daysSinceMyReply: day 0 is "too early to raise", and
    // flooring would turn every message sent this morning into a day-1 follow-up.
    const t = thread("x", 1, { messages: [LEAD_MSG, myMsgSent(0, 3 * HOUR)] });
    expect(idleStats(t, NOW)).toMatchObject({ daysAwaitingLead: 0 });
  });
});

describe("buildDigestSystemPrompt", () => {
  const prompt = buildDigestSystemPrompt("# PLAYBOOK BODY\n### 1.7 реклама");

  it("embeds the playbook as the single source of truth", () => {
    expect(prompt).toContain("<playbook>\n# PLAYBOOK BODY\n### 1.7 реклама\n</playbook>");
    expect(prompt).toContain("ЕДИНСТВЕННЫЙ источник истины");
  });

  it("requires the scenario number in reason", () => {
    expect(prompt).toContain('начинается с номера');
    expect(prompt).toContain('"сценарий 1.7 — вопрос про рекламу"');
  });

  it("routes spam (9.4) and non-target leads (1.10) to skip, but not the target niches", () => {
    expect(prompt).toContain("раздел 9.4");
    expect(prompt).toContain("раздел 1.10");
    expect(prompt).toContain("лазер, косметолог, брови, ресницы — ЦЕЛЕВЫЕ");
  });

  it("spells out the follow-up ladder against daysAwaitingLead", () => {
    expect(prompt).toContain("ФОЛЛОУ-АП — только когда daysAwaitingLead > 0");
    expect(prompt).toContain("1 день — сценарий 8.1");
    expect(prompt).toContain("2 дня — сценарий 8.2");
    expect(prompt).toContain("4 дня — сценарий 8.3");
    expect(prompt).toContain("7 дней — сценарий 8.4");
    // Day 0 is too early, and past 8.4 the thread is closed unless 8.5 has a
    // real reason — the two ends of the ladder that are easiest to get wrong.
    expect(prompt).toContain("0 (тот же день, прошло несколько часов) — priority = skip");
    expect(prompt).toContain("тред закрыт по");
    expect(prompt).toContain("РЕАЛЬНЫЙ повод");
  });

  it("states the 14-day trial and that the trial day is not in the data", () => {
    expect(prompt).toContain("Триал длится 14 дней");
    expect(prompt).toContain("дня триала в этих данных НЕТ");
    expect(prompt).toContain("[N] gün qalıb");
  });

  it("separates fillable placeholders from unresolved ones", () => {
    expect(prompt).toContain("[ad], [Имя], [N] usta");
    expect(prompt).toContain("[ПРОВЕРЬ], [РЕШИ], [где: ПРОВЕРЬ]");
    expect(prompt).toContain(`action = "${NEEDS_DECISION_ACTION}"`);
  });

  it("drops the rules the playbook now owns", () => {
    // Each of these contradicted a playbook scenario: 7.0 is a long message,
    // 8.4 / 9.1 / 9.3 / 1.10 close without a question, and 2.1 already names one
    // tariff per case. "личное" is now sections 1.10 / 9.4.
    expect(prompt).not.toContain("максимум 4 строки");
    expect(prompt).not.toContain("обязательно заканчивается вопросом");
    expect(prompt).not.toContain("не перечислять все три тарифа");
    expect(prompt).not.toContain("это спам или личное");
  });
});

describe("flattenMarkdownLinks", () => {
  it("turns the playbook's self-links into bare URLs", () => {
    // Exactly how every scenario writes the demo link. Sent as-is to a DM it
    // would arrive as literal markdown.
    expect(
      flattenMarkdownLinks(
        "Belə görünür: [https://salonbook.az/demostudio](https://salonbook.az/demostudio)",
      ),
    ).toBe("Belə görünür: https://salonbook.az/demostudio");
  });

  it("keeps a labelled link readable", () => {
    expect(flattenMarkdownLinks("[Qeydiyyat](https://salonbook.az/register) — 2 dəqiqə")).toBe(
      "Qeydiyyat https://salonbook.az/register — 2 dəqiqə",
    );
  });

  it("leaves a real placeholder alone", () => {
    expect(flattenMarkdownLinks("Sınağın [N] günü qalıb")).toBe("Sınağın [N] günü qalıb");
  });
});

describe("unresolvedPlaceholders", () => {
  it("finds what must never reach a salon", () => {
    expect(unresolvedPlaceholders("Bəli, siyahını özünüz yükləyirsiniz — [где: ПРОВЕРЬ].")).toEqual(
      ["[где: ПРОВЕРЬ]"],
    );
    expect(unresolvedPlaceholders("Sınağın [N] günü qalıb, tarif [X]")).toEqual(["[N]", "[X]"]);
  });

  it("is quiet on a finished draft", () => {
    expect(unresolvedPlaceholders("5 usta — Salon tarifi, 35 AZN/ay. Linki göndərim?")).toEqual([]);
  });
});

describe("formatTranscript", () => {
  it("labels speakers, flattens newlines and keeps text-less messages", () => {
    const out = formatTranscript([
      { fromMe: false, text: "Salam\nqiymət?", attach: null, sentAt: daysAgo(2) },
      { fromMe: true, text: "Salam!", attach: null, sentAt: daysAgo(2) },
      { fromMe: false, text: null, attach: { type: "image" }, sentAt: daysAgo(1) },
    ]);
    expect(out).toBe("LEAD: Salam qiymət?\nME: Salam!\nLEAD: [вложение]");
  });
});

describe("buildDigestPrompt", () => {
  it("puts every thread under a header carrying its igUserId and all three counters", () => {
    const prompt = buildDigestPrompt(
      [
        thread("111", 3),
        answered("222", 5),
        thread("333", null, { username: null, messages: [myMsgSent(2)] }),
      ],
      NOW,
    );
    expect(prompt).toContain("Переписок: 3.");
    expect(prompt).toContain(
      "### igUserId: 111 | @user_111 · Name 111 | daysIdle: 3 | daysSinceMyReply: 3 | daysAwaitingLead: 0",
    );
    expect(prompt).toContain(
      "### igUserId: 222 | @user_222 · Name 222 | daysIdle: 5 | daysSinceMyReply: 0 | daysAwaitingLead: 5",
    );
    expect(prompt).toContain(
      "### igUserId: 333 | Name 333 | daysIdle: null | daysSinceMyReply: 0 | daysAwaitingLead: 2",
    );
    expect(prompt).toContain("LEAD: Salam");
  });
});

describe("parseDigestResponse", () => {
  it("reads a bare array", () => {
    const { verdicts, rejected } = parseDigestResponse(JSON.stringify([verdict("1", "hot")]));
    expect(verdicts).toHaveLength(1);
    expect(rejected).toBe(0);
  });

  it("tolerates a markdown fence around the array", () => {
    const text = "```json\n" + JSON.stringify([verdict("1", "warm")]) + "\n```";
    expect(parseDigestResponse(text).verdicts[0].priority).toBe("warm");
  });

  it("drops malformed entries without losing the rest", () => {
    const text = JSON.stringify([verdict("1", "hot"), { igUserId: "2", priority: "urgent" }, 42]);
    const { verdicts, rejected } = parseDigestResponse(text);
    expect(verdicts.map((v) => v.igUserId)).toEqual(["1"]);
    expect(rejected).toBe(2);
  });

  it("throws when there is no array at all", () => {
    expect(() => parseDigestResponse("Sorry, I can't help")).toThrow();
    expect(() => parseDigestResponse('{"items": 1}')).toThrow();
    expect(() => parseDigestResponse("[1, 2")).toThrow();
  });
});

describe("buildDigestItems", () => {
  const order = (items: ReturnType<typeof buildDigestItems>) =>
    items.map((i) => `${i.priority}:${i.igUserId}`);

  it("puts every waiting lead first, then hot → warm → cold, and drops skip", () => {
    const threads = [
      answered("hotA", 5),
      answered("hotB", 1),
      thread("coldWaiting", 2),
      answered("warm", 2),
      thread("warmWaiting", 4),
      answered("skipped", 0),
      answered("cold", 9),
    ];
    const items = buildDigestItems(
      [
        verdict("cold", "cold"),
        verdict("hotA", "hot"),
        verdict("skipped", "skip"),
        verdict("warm", "warm"),
        verdict("coldWaiting", "cold"),
        verdict("hotB", "hot"),
        verdict("warmWaiting", "warm"),
      ],
      threads,
      NOW,
    );
    expect(order(items)).toEqual([
      "warm:warmWaiting",
      "cold:coldWaiting",
      "hot:hotB",
      "hot:hotA",
      "warm:warm",
      "cold:cold",
    ]);
  });

  it("breaks ties by the longest wait, then by the freshest lead, never-wrote last", () => {
    const items = buildDigestItems(
      [
        verdict("wait2", "hot"),
        verdict("wait7", "hot"),
        verdict("silent", "warm"),
        verdict("fresh", "warm"),
        verdict("stale", "warm"),
      ],
      [
        thread("wait2", 2),
        thread("wait7", 7),
        thread("silent", null, { messages: [myMsgSent(3)] }),
        answered("fresh", 1),
        answered("stale", 8),
      ],
      NOW,
    );
    expect(order(items)).toEqual([
      "hot:wait7",
      "hot:wait2",
      "warm:fresh",
      "warm:stale",
      "warm:silent",
    ]);
  });

  it("takes names and all three counters from the thread, trims text, starts not done", () => {
    const [item] = buildDigestItems([verdict("a", "hot")], [thread("a", 5)], NOW);
    expect(item).toEqual({
      igUserId: "a",
      username: "user_a",
      name: "Name a",
      daysIdle: 5,
      daysSinceMyReply: 5,
      daysAwaitingLead: 0,
      priority: "hot",
      reason: "r",
      action: "a",
      draft: "d?",
      done: false,
    });
  });

  it("turns a draft with unresolved brackets into a decision, hot and text-free", () => {
    // The 4.6 case: the scenario cannot be sent until the founder settles where
    // the import lives, so a ready-looking draft would be the dangerous outcome.
    const [item] = buildDigestItems(
      [
        {
          igUserId: "a",
          priority: "cold",
          reason: "сценарий 4.6 — спрашивает про перенос базы",
          action: "отправить 4.6",
          draft: "Bəli, siyahını özünüz yükləyirsiniz — [где: ПРОВЕРЬ]. Neçə müştəridir?",
        },
      ],
      [thread("a", 2)],
      NOW,
    );
    expect(item.draft).toBe("");
    expect(item.action).toBe(NEEDS_DECISION_ACTION);
    expect(item.priority).toBe("hot");
    expect(item.reason).toBe(
      "сценарий 4.6 — спрашивает про перенос базы — не заполнено: [где: ПРОВЕРЬ]",
    );
  });

  it("leaves a finished draft untouched", () => {
    const [item] = buildDigestItems(
      [
        {
          igUserId: "a",
          priority: "warm",
          reason: "сценарий 3.8 — спросил цену на 5 мастеров",
          action: "отправить 3.8",
          draft: "5 usta — Salon tarifi, 35 AZN/ay. Qeydiyyat linkini göndərim?",
        },
      ],
      [thread("a", 1)],
      NOW,
    );
    expect(item.draft).toBe("5 usta — Salon tarifi, 35 AZN/ay. Qeydiyyat linkini göndərim?");
    expect(item.action).toBe("отправить 3.8");
    expect(item.priority).toBe("warm");
  });

  it("does not mistake a scenario's markdown link for an unresolved placeholder", () => {
    // The regression this guards: almost every scenario carries the demo link in
    // markdown, so treating its brackets as unresolved would have emptied most of
    // the digest. Verbatim text of scenario 1.4.
    const [item] = buildDigestItems(
      [
        {
          igUserId: "a",
          priority: "hot",
          reason: "сценарий 1.4 — просит демо",
          action: "отправить 1.4",
          draft:
            "Salam! Bəli, var 🙌\nMüştərinin gördüyü səhifə belədir: [https://salonbook.az/demostudio](https://salonbook.az/demostudio)\nSalonunuzda neçə usta işləyir?",
        },
      ],
      [thread("a", 1)],
      NOW,
    );
    expect(item.draft).toContain("səhifə belədir: https://salonbook.az/demostudio\n");
    expect(item.draft).not.toContain("[");
    expect(item.action).toBe("отправить 1.4");
  });

  it("still drops a skip verdict even when its draft has brackets", () => {
    const items = buildDigestItems(
      [{ igUserId: "a", priority: "skip", reason: "9.4 спам", action: "—", draft: "[повод]" }],
      [thread("a", 1)],
      NOW,
    );
    expect(items).toEqual([]);
  });

  it("ignores ids that weren't in the input and keeps the first verdict for a repeat", () => {
    const items = buildDigestItems(
      [verdict("zzz", "hot"), verdict("a", "warm"), verdict("a", "hot")],
      [answered("a", 1)],
      NOW,
    );
    expect(order(items)).toEqual(["warm:a"]);
  });
});

describe("readDigestItems", () => {
  it("round-trips stored items with their array index and skips junk", () => {
    const stored = buildDigestItems(
      [verdict("a", "hot"), verdict("b", "cold")],
      [thread("a", 1), thread("b", null, { messages: [myMsgSent(4)] })],
      NOW,
    );
    const json = JSON.parse(JSON.stringify([stored[0], { nope: true }, stored[1]]));
    const read = readDigestItems(json);
    expect(
      read.map((i) => [i.index, i.igUserId, i.daysIdle, i.daysSinceMyReply, i.daysAwaitingLead]),
    ).toEqual([
      [0, "a", 1, 1, 0],
      [2, "b", null, 0, 4],
    ]);
    expect(readDigestItems(null)).toEqual([]);
  });

  it("reads a digest stored before daysAwaitingLead existed", () => {
    // Old rows have no such field; dropping them would erase digest history.
    const legacy = [
      {
        igUserId: "a",
        username: null,
        name: null,
        daysIdle: 3,
        daysSinceMyReply: 0,
        priority: "warm",
        reason: "r",
        action: "a",
        draft: "d?",
        done: true,
      },
    ];
    expect(readDigestItems(legacy)).toMatchObject([{ igUserId: "a", daysAwaitingLead: 0 }]);
  });
});

describe("digestTemplateComponents", () => {
  it("fills {{1}} with the count and {{2}} with the link", () => {
    expect(digestTemplateComponents(7, "https://salonbook.az/dashboard/ig-digest")).toEqual([
      {
        type: "body",
        parameters: [
          { type: "text", text: "7" },
          { type: "text", text: "https://salonbook.az/dashboard/ig-digest" },
        ],
      },
    ]);
  });
});

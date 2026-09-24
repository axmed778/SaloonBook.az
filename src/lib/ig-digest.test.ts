import { describe, it, expect } from "vitest";
import {
  IG_DIGEST_SYSTEM_PROMPT,
  buildDigestItems,
  buildDigestPrompt,
  digestTemplateComponents,
  formatTranscript,
  idleStats,
  parseDigestResponse,
  readDigestItems,
  type IgDigestThread,
  type IgDigestVerdict,
} from "./ig-digest";

const NOW = new Date("2026-09-24T05:50:00Z");
const HOUR = 3_600_000;
const daysAgo = (n: number, extraMs = 0) => new Date(NOW.getTime() - n * 86_400_000 - extraMs);

const LEAD_MSG = { fromMe: false, text: "Salam", attach: null };
const MY_MSG = { fromMe: true, text: "Salam!", attach: null };

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

/** Same, but our reply is the last message: nobody is waiting on us. */
const answered = (igUserId: string, leadDays: number | null) =>
  thread(igUserId, leadDays, { messages: [LEAD_MSG, MY_MSG] });

function verdict(igUserId: string, priority: IgDigestVerdict["priority"]): IgDigestVerdict {
  return { igUserId, priority, reason: " r ", action: " a ", draft: " d? " };
}

describe("idleStats", () => {
  it("counts daysIdle from the lead's last message, not ours", () => {
    // The lead went quiet 6 days ago; our follow-up must not reset the clock.
    expect(idleStats(answered("x", 6), NOW)).toEqual({ daysIdle: 6, daysSinceMyReply: 0 });
  });

  it("is null when the lead never wrote", () => {
    const t = thread("x", null, { messages: [MY_MSG] });
    expect(idleStats(t, NOW)).toEqual({ daysIdle: null, daysSinceMyReply: 0 });
  });

  it("counts the wait when the lead wrote last", () => {
    expect(idleStats(thread("x", 3, { lastLeadMessageAt: daysAgo(3, 5 * HOUR) }), NOW)).toEqual({
      daysIdle: 3,
      daysSinceMyReply: 3,
    });
  });

  it("reports a same-day unanswered message as 1, never as 0", () => {
    const t = thread("x", 0, { lastLeadMessageAt: new Date(NOW.getTime() - 2 * HOUR) });
    expect(idleStats(t, NOW)).toEqual({ daysIdle: 0, daysSinceMyReply: 1 });
  });
});

describe("formatTranscript", () => {
  it("labels speakers, flattens newlines and keeps text-less messages", () => {
    const out = formatTranscript([
      { fromMe: false, text: "Salam\nqiymət?", attach: null },
      { fromMe: true, text: "Salam!", attach: null },
      { fromMe: false, text: null, attach: { type: "image" } },
    ]);
    expect(out).toBe("LEAD: Salam qiymət?\nME: Salam!\nLEAD: [вложение]");
  });
});

describe("buildDigestPrompt", () => {
  it("puts every thread under a header carrying its igUserId and both counters", () => {
    const prompt = buildDigestPrompt(
      [thread("111", 3), answered("222", 5), thread("333", null, { username: null, messages: [MY_MSG] })],
      NOW,
    );
    expect(prompt).toContain("Переписок: 3.");
    expect(prompt).toContain("### igUserId: 111 | @user_111 · Name 111 | daysIdle: 3 | daysSinceMyReply: 3");
    expect(prompt).toContain("### igUserId: 222 | @user_222 · Name 222 | daysIdle: 5 | daysSinceMyReply: 0");
    expect(prompt).toContain("### igUserId: 333 | Name 333 | daysIdle: null | daysSinceMyReply: 0");
    expect(prompt).toContain("LEAD: Salam");
  });

  it("tells Claude what a positive daysSinceMyReply means", () => {
    expect(IG_DIGEST_SYSTEM_PROMPT).toContain(
      "daysSinceMyReply > 0 означает, что лид написал последним и ждёт\nответа — такие треды почти всегда priority = hot.",
    );
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
        thread("silent", null, { messages: [MY_MSG] }),
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

  it("takes names and both counters from the thread, trims text, starts not done", () => {
    const [item] = buildDigestItems([verdict("a", "hot")], [thread("a", 5)], NOW);
    expect(item).toEqual({
      igUserId: "a",
      username: "user_a",
      name: "Name a",
      daysIdle: 5,
      daysSinceMyReply: 5,
      priority: "hot",
      reason: "r",
      action: "a",
      draft: "d?",
      done: false,
    });
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
      [thread("a", 1), thread("b", null, { messages: [MY_MSG] })],
      NOW,
    );
    const json = JSON.parse(JSON.stringify([stored[0], { nope: true }, stored[1]]));
    const read = readDigestItems(json);
    expect(read.map((i) => [i.index, i.igUserId, i.daysIdle, i.daysSinceMyReply])).toEqual([
      [0, "a", 1, 1],
      [2, "b", null, 0],
    ]);
    expect(readDigestItems(null)).toEqual([]);
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

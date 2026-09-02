import { describe, it, expect } from "vitest";
import { parseIgWebhook, parseIgEvent, igEventTime } from "./ig-events";

const SELF = "17841400000000000"; // our IG_USER_ID
const LEAD = "78901234567890123";

function envelope(events: unknown[], entryTime?: number) {
  return { object: "instagram", entry: [{ time: entryTime, messaging: events }] };
}

function inbound(overrides: Record<string, unknown> = {}) {
  return {
    sender: { id: LEAD },
    recipient: { id: SELF },
    timestamp: 1_756_000_000_000,
    message: { mid: "mid.inbound.1", text: "Salam, qiymət nə qədər?" },
    ...overrides,
  };
}

describe("parseIgEvent", () => {
  it("reads an inbound message as coming from the lead", () => {
    const p = parseIgEvent(inbound(), undefined, SELF);
    expect(p).not.toBeNull();
    expect(p!.igUserId).toBe(LEAD);
    expect(p!.fromMe).toBe(false);
    expect(p!.mid).toBe("mid.inbound.1");
    expect(p!.text).toBe("Salam, qiymət nə qədər?");
    expect(p!.sentAt.toISOString()).toBe(new Date(1_756_000_000_000).toISOString());
  });

  // The single most error-prone rule in the whole integration: on an echo the
  // envelope is inverted, so reading sender.id would file our own reply under a
  // thread keyed by our own account.
  it("takes the peer from `recipient` when is_echo is set", () => {
    const p = parseIgEvent(
      {
        sender: { id: SELF },
        recipient: { id: LEAD },
        timestamp: 1_756_000_001_000,
        message: { mid: "mid.echo.1", text: "35 AZN", is_echo: true },
      },
      undefined,
      SELF,
    );
    expect(p).not.toBeNull();
    expect(p!.igUserId).toBe(LEAD);
    expect(p!.fromMe).toBe(true);
  });

  it("treats a non-boolean is_echo as not an echo", () => {
    const p = parseIgEvent(inbound({ message: { mid: "m", is_echo: "true" } }), undefined, SELF);
    expect(p!.fromMe).toBe(false);
    expect(p!.igUserId).toBe(LEAD);
  });

  it("skips events with no mid (reactions, read receipts, typing)", () => {
    expect(parseIgEvent({ sender: { id: LEAD }, message: {} }, undefined, SELF)).toBeNull();
    expect(
      parseIgEvent({ sender: { id: LEAD }, reaction: { emoji: "❤" } } as never, undefined, SELF),
    ).toBeNull();
    expect(parseIgEvent({ sender: { id: LEAD }, read: { mid: "x" } } as never, undefined, SELF))
      .toBeNull();
  });

  it("skips a message to our own account", () => {
    const p = parseIgEvent(
      { sender: { id: SELF }, recipient: { id: SELF }, message: { mid: "m1" } },
      undefined,
      SELF,
    );
    expect(p).toBeNull();
  });

  it("skips an event with no usable peer id", () => {
    expect(parseIgEvent({ message: { mid: "m1" } }, undefined, SELF)).toBeNull();
    expect(
      parseIgEvent({ sender: { id: 12345 }, message: { mid: "m1" } }, undefined, SELF),
    ).toBeNull();
  });

  it("keeps attachments as JSON and non-string text as null", () => {
    const attachments = [{ type: "image", payload: { url: "https://cdn.example/x.jpg" } }];
    const p = parseIgEvent(
      inbound({ message: { mid: "m1", attachments, text: { nested: true } } }),
      undefined,
      SELF,
    );
    expect(p!.text).toBeNull();
    expect(p!.attach).toEqual(attachments);
  });

  it("stores no attachment for a plain text message", () => {
    expect(parseIgEvent(inbound(), undefined, SELF)!.attach).toBeNull();
  });
});

describe("igEventTime", () => {
  it("reads epoch milliseconds", () => {
    expect(igEventTime(1_756_000_000_000, undefined).getTime()).toBe(1_756_000_000_000);
  });

  it("falls back to the entry time, then to now", () => {
    expect(igEventTime(undefined, 1_756_000_000_000).getTime()).toBe(1_756_000_000_000);
    expect(igEventTime("nope", 0).getTime()).toBeGreaterThan(0);
    expect(igEventTime(NaN, undefined).getTime()).toBeGreaterThan(0);
  });
});

describe("parseIgWebhook", () => {
  it("flattens entries and drops the unstorable ones", () => {
    const parsed = parseIgWebhook(
      envelope([
        inbound({ message: { mid: "a", text: "one" } }),
        { sender: { id: LEAD }, message: {} }, // no mid
        {
          sender: { id: SELF },
          recipient: { id: LEAD },
          message: { mid: "b", text: "two", is_echo: true },
        },
      ]),
      SELF,
    );
    expect(parsed.map((p) => p.mid)).toEqual(["a", "b"]);
    expect(parsed.map((p) => p.fromMe)).toEqual([false, true]);
  });

  it("inherits the entry timestamp when the event has none", () => {
    const parsed = parseIgWebhook(
      envelope([{ sender: { id: LEAD }, message: { mid: "a" } }], 1_756_000_000_000),
      SELF,
    );
    expect(parsed[0].sentAt.getTime()).toBe(1_756_000_000_000);
  });

  // Anything Meta (or an attacker, pre-HMAC) can post must come back as an
  // empty list, never a throw: the route's contract is a prompt 200.
  it("returns nothing for junk instead of throwing", () => {
    for (const junk of [null, undefined, {}, [], "string", 42, { entry: "nope" }, { entry: [{}] }]) {
      expect(parseIgWebhook(junk, SELF)).toEqual([]);
    }
  });
});

import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import type { Redis } from "ioredis";
import {
  INCR_WITH_TTL_LUA,
  incrWithTtl,
  rateLimit,
  consumeOutboundQuota,
  type IncrWithTtlClient,
} from "./ratelimit";

// ratelimit.ts builds its own ioredis client at import time, so the only seam
// for a unit test is the driver: swap ioredis for an in-memory fake. Time never
// advances here — TTLs are stored as plain seconds and only read back, which is
// exactly the property the Lua script exists to guarantee ("does this counter
// have an expiry at all?"), and the property that INCR-then-EXPIRE loses when
// the process dies between the two round trips.
const fake = vi.hoisted(() => {
  type Entry = { value: number; ttl: number | null };
  const store = new Map<string, Entry>();
  /** Commands actually sent to the server, so tests can count round trips. */
  const sent: string[] = [];
  const state = { failNextCommand: false, lua: "", numberOfKeys: -1 };

  class FakeRedis {
    status = "ready";
    /** Installed by defineCommand, exactly as ioredis does. */
    rlIncrWithTtl?: (key: string, windowSec: number) => Promise<[number, number]>;

    on() {
      return this;
    }

    connect() {
      return Promise.resolve();
    }

    async ping(): Promise<string> {
      this.#send("ping");
      return "PONG";
    }

    async get(key: string): Promise<string | null> {
      this.#send("get");
      const entry = store.get(key);
      return entry ? String(entry.value) : null;
    }

    async ttl(key: string): Promise<number> {
      this.#send("ttl");
      const entry = store.get(key);
      if (!entry) return -2;
      return entry.ttl ?? -1;
    }

    defineCommand(name: string, definition: { lua: string; numberOfKeys?: number }) {
      state.lua = definition.lua;
      state.numberOfKeys = definition.numberOfKeys ?? 0;
      // A transcription of INCR_WITH_TTL_LUA. The redis.call()s inside a script
      // run server-side, so this counts as ONE round trip — which is the whole
      // point of the change and what the round-trip assertions below check. The
      // real Lua is executed by the opt-in suite at the bottom of this file.
      this.rlIncrWithTtl = async (key, windowSec) => {
        this.#send(name);
        const entry = store.get(key) ?? { value: 0, ttl: null };
        entry.value += 1;
        store.set(key, entry);
        let ttl = entry.ttl ?? -1;
        if (entry.value === 1 || ttl < 0) {
          entry.ttl = windowSec;
          ttl = windowSec;
        }
        return [entry.value, ttl];
      };
    }

    #send(command: string) {
      sent.push(command);
      if (state.failNextCommand) {
        state.failNextCommand = false;
        throw new Error("ECONNREFUSED");
      }
    }
  }

  return { store, sent, state, FakeRedis };
});

// Hoisted above the imports by vitest, so ./ratelimit builds its client on top
// of FakeRedis rather than opening a socket.
vi.mock("ioredis", () => ({ default: fake.FakeRedis }));

const { store, sent, state } = fake;

beforeEach(() => {
  store.clear();
  sent.length = 0;
  state.failNextCommand = false;
  // Fail-open paths log; keep the test output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("INCR_WITH_TTL_LUA", () => {
  it("is the script registered on the rate-limit client, keyed by one key", () => {
    expect(state.lua).toBe(INCR_WITH_TTL_LUA);
    expect(state.numberOfKeys).toBe(1);
  });

  it("expires the key both on the first increment and whenever the TTL is gone", () => {
    expect(INCR_WITH_TTL_LUA).toContain("'INCR', KEYS[1]");
    expect(INCR_WITH_TTL_LUA).toContain("'EXPIRE', KEYS[1], ARGV[1]");
    // The `ttl < 0` half is the repair branch: without it a key that lost its
    // expiry (crash between INCR and EXPIRE on an older build) blocks forever.
    expect(INCR_WITH_TTL_LUA).toContain("if count == 1 or ttl < 0 then");
  });
});

describe("rateLimit", () => {
  it("sets a TTL on the first increment", async () => {
    const res = await rateLimit("ip:1.2.3.4", 5, 60);

    expect(store.get("rl:ip:1.2.3.4")).toEqual({ value: 1, ttl: 60 });
    expect(res).toEqual({ allowed: true, remaining: 4, resetSec: 60 });
  });

  it("counts and expires in a single round trip", async () => {
    await rateLimit("ip:1.2.3.4", 5, 60);

    // No trailing EXPIRE/TTL commands: nothing can die between them anymore.
    expect(sent).toEqual(["rlIncrWithTtl"]);
  });

  it("keeps the window's remaining TTL on later increments", async () => {
    store.set("rl:ip:1.2.3.4", { value: 1, ttl: 30 });

    const res = await rateLimit("ip:1.2.3.4", 5, 60);

    // Fixed window: the second hit must not push the reset back out to 60.
    expect(store.get("rl:ip:1.2.3.4")).toEqual({ value: 2, ttl: 30 });
    expect(res.resetSec).toBe(30);
  });

  it("gives a TTL back to a key that somehow has none", async () => {
    // The stuck state the old INCR-then-EXPIRE pair could leave behind: a
    // counter over the limit with no expiry, i.e. an IP blocked forever.
    store.set("rl:ip:1.2.3.4", { value: 9, ttl: null });

    const res = await rateLimit("ip:1.2.3.4", 5, 60);

    expect(store.get("rl:ip:1.2.3.4")).toEqual({ value: 10, ttl: 60 });
    expect(res).toEqual({ allowed: false, remaining: 0, resetSec: 60 });
  });

  it("fails open when Redis errors", async () => {
    state.failNextCommand = true;

    expect(await rateLimit("ip:1.2.3.4", 5, 60)).toEqual({
      allowed: true,
      remaining: 5,
      resetSec: 60,
    });
  });
});

describe("consumeOutboundQuota", () => {
  const PHONE = "+994501234567";
  const DAY = 86_400;

  it("sets a TTL on the first permit", async () => {
    expect(await consumeOutboundQuota(PHONE, 3, DAY)).toBe(true);
    expect(store.get(`out:${PHONE}`)).toEqual({ value: 1, ttl: DAY });
    expect(sent).toEqual(["rlIncrWithTtl"]);
  });

  it("gives a TTL back to a quota key that somehow has none", async () => {
    store.set(`out:${PHONE}`, { value: 1, ttl: null });

    expect(await consumeOutboundQuota(PHONE, 3, DAY)).toBe(true);
    expect(store.get(`out:${PHONE}`)).toEqual({ value: 2, ttl: DAY });
  });

  it("refuses once the cap is reached, and fails open on a Redis error", async () => {
    store.set(`out:${PHONE}`, { value: 3, ttl: DAY });
    expect(await consumeOutboundQuota(PHONE, 3, DAY)).toBe(false);

    state.failNextCommand = true;
    expect(await consumeOutboundQuota(PHONE, 3, DAY)).toBe(true);
  });
});

// Opt-in: runs the real Lua on a real server, which is the only way to prove
// the script itself (not a transcription of it) keeps the TTL invariant.
// Same shape as the RLS suite — skipped unless the URL is exported:
//
//   REDIS_TEST_URL=redis://localhost:6379 pnpm test src/lib/ratelimit.script.test.ts
const REDIS_TEST_URL = process.env.REDIS_TEST_URL;

describe.skipIf(!REDIS_TEST_URL)("INCR_WITH_TTL_LUA on a real Redis", () => {
  const KEY = `rl:test:${Date.now()}`;
  let client!: Redis;
  let scripted!: IncrWithTtlClient;

  beforeAll(async () => {
    // This file mocks ioredis, so reach past the mock for the genuine client.
    const ioredis = await vi.importActual<typeof import("ioredis")>("ioredis");
    client = new ioredis.default(REDIS_TEST_URL!, { lazyConnect: true, family: 0 });
    client.defineCommand("rlIncrWithTtl", { numberOfKeys: 1, lua: INCR_WITH_TTL_LUA });
    await client.connect();
    await client.del(KEY);
    scripted = client as unknown as IncrWithTtlClient;
  });

  afterAll(async () => {
    if (!client) return;
    await client.del(KEY);
    client.disconnect();
  });

  it("expires the key on the first increment, and repairs a key with no TTL", async () => {
    const first = await incrWithTtl(scripted, KEY, 60);
    expect(first.count).toBe(1);
    expect(first.ttl).toBe(60);
    expect(await client.ttl(KEY)).toBeGreaterThan(0);

    // PERSIST reproduces the stuck key the old two-command version could leave.
    await client.persist(KEY);
    expect(await client.ttl(KEY)).toBe(-1);

    const second = await incrWithTtl(scripted, KEY, 60);
    expect(second.count).toBe(2);
    expect(second.ttl).toBe(60);
    expect(await client.ttl(KEY)).toBeGreaterThan(0);
  });
});

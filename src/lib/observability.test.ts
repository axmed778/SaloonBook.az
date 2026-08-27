import { describe, it, expect } from "vitest";
import {
  parseSentryDsn,
  sentryAuthHeader,
  parseStackFrames,
  buildSentryEvent,
  buildEnvelope,
  errorFingerprint,
  type ParsedDsn,
} from "./observability";

// These are the two things that silently break a hand-rolled Sentry client: a
// mis-derived ingest URL (every event 404s) and a wrong item-header length
// (Sentry rejects the envelope). Both are pure functions, so both are testable
// without a network.

const DSN = "https://abc123def456@o987.ingest.sentry.io/4505";

describe("parseSentryDsn", () => {
  it("derives the envelope endpoint from a standard DSN", () => {
    const parsed = parseSentryDsn(DSN);
    expect(parsed).not.toBeNull();
    expect(parsed?.publicKey).toBe("abc123def456");
    expect(parsed?.projectId).toBe("4505");
    expect(parsed?.ingestUrl).toBe("https://o987.ingest.sentry.io/api/4505/envelope/");
  });

  it("keeps a sub-path prefix, as self-hosted Sentry serves one", () => {
    const parsed = parseSentryDsn("https://key@sentry.example.com/sentry/inner/42");
    expect(parsed?.projectId).toBe("42");
    expect(parsed?.ingestUrl).toBe(
      "https://sentry.example.com/sentry/inner/api/42/envelope/",
    );
  });

  it("keeps a non-default port", () => {
    const parsed = parseSentryDsn("http://key@localhost:9000/2");
    expect(parsed?.ingestUrl).toBe("http://localhost:9000/api/2/envelope/");
  });

  it("uses only the public half of a legacy key:secret DSN", () => {
    const parsed = parseSentryDsn("https://pub:secret@o1.ingest.sentry.io/7");
    expect(parsed?.publicKey).toBe("pub");
    expect(parsed?.ingestUrl).toBe("https://o1.ingest.sentry.io/api/7/envelope/");
  });

  it("trims surrounding whitespace, which env vars routinely carry", () => {
    expect(parseSentryDsn(`  ${DSN}  `)?.projectId).toBe("4505");
  });

  it("returns null instead of throwing on anything unusable", () => {
    // A typo in an env var must not throw from inside an error handler.
    for (const bad of [
      undefined,
      null,
      "",
      "   ",
      "not-a-url",
      "ftp://key@host/1",
      "https://o1.ingest.sentry.io/4505", // no public key
      "https://key@o1.ingest.sentry.io/", // no project id
    ]) {
      expect(parseSentryDsn(bad)).toBeNull();
    }
  });
});

describe("sentryAuthHeader", () => {
  it("carries version 7 and the public key", () => {
    const dsn = parseSentryDsn(DSN) as ParsedDsn;
    expect(sentryAuthHeader(dsn)).toBe(
      "Sentry sentry_version=7, sentry_client=salonbook/1.0, sentry_key=abc123def456",
    );
  });
});

describe("parseStackFrames", () => {
  const stack = [
    "TypeError: cannot read properties of undefined",
    "    at createBooking (/app/src/lib/booking.ts:120:15)",
    "    at async POST (/app/src/app/api/bookings/route.ts:44:3)",
    "    at /app/src/lib/handler.ts:9:1",
    "    at Module._compile (node:internal/modules/cjs/loader:1105:14)",
    "    at process (/app/node_modules/next/dist/server/x.js:3:4)",
    "    at native",
  ].join("\n");

  it("reverses V8 order so the throwing frame is last, as Sentry renders it", () => {
    const frames = parseStackFrames(stack);
    expect(frames[frames.length - 1]).toMatchObject({
      function: "createBooking",
      filename: "/app/src/lib/booking.ts",
      lineno: 120,
      colno: 15,
      in_app: true,
    });
  });

  it("handles the bare `at file:line:col` form with no function name", () => {
    const frames = parseStackFrames(stack);
    const bare = frames.find((f) => f.filename === "/app/src/lib/handler.ts");
    expect(bare).toBeDefined();
    expect(bare?.function).toBeUndefined();
    expect(bare?.lineno).toBe(9);
  });

  it("marks node internals and node_modules as not in_app", () => {
    const frames = parseStackFrames(stack);
    const byFile = Object.fromEntries(frames.map((f) => [f.filename, f.in_app]));
    expect(byFile["node:internal/modules/cjs/loader"]).toBe(false);
    expect(byFile["/app/node_modules/next/dist/server/x.js"]).toBe(false);
  });

  it("skips the header line and locationless frames", () => {
    // 6 "at" lines minus "at native", which carries no file:line:col.
    expect(parseStackFrames(stack)).toHaveLength(5);
  });

  it("splits a Windows path correctly despite its drive-letter colon", () => {
    const frames = parseStackFrames("Error: x\n    at run (C:\\app\\src\\lib\\a.ts:12:34)");
    expect(frames[0]).toMatchObject({
      filename: "C:\\app\\src\\lib\\a.ts",
      lineno: 12,
      colno: 34,
    });
  });

  it("returns an empty list for a missing stack", () => {
    expect(parseStackFrames(undefined)).toEqual([]);
    expect(parseStackFrames("")).toEqual([]);
  });
});

describe("buildSentryEvent", () => {
  const opts = {
    eventId: "0123456789abcdef0123456789abcdef",
    timestampMs: 1_700_000_000_500,
    environment: "production",
  };

  it("produces an exception value with the error type, message and frames", () => {
    const err = new TypeError("boom");
    err.stack = "TypeError: boom\n    at run (/app/src/a.ts:1:2)";
    const event = buildSentryEvent(err, { source: "worker" }, opts);

    expect(event.platform).toBe("node");
    expect(event.level).toBe("error");
    expect(event.environment).toBe("production");
    // Sentry timestamps are unix SECONDS, not milliseconds.
    expect(event.timestamp).toBe(1_700_000_000);
    expect(event.exception).toEqual({
      values: [
        {
          type: "TypeError",
          value: "boom",
          stacktrace: {
            frames: [
              { filename: "/app/src/a.ts", function: "run", lineno: 1, colno: 2, in_app: true },
            ],
          },
        },
      ],
    });
  });

  it("always tags the source and drops nullish tag values", () => {
    const event = buildSentryEvent(new Error("x"), {
      source: "onRequestError",
      tags: { route: "/az/salon", digest: null, method: undefined, status: 500, blank: "" },
    }, opts);
    expect(event.tags).toEqual({ source: "onRequestError", route: "/az/salon", status: "500" });
  });

  it("honours an explicit level and release", () => {
    const event = buildSentryEvent(new Error("x"), { source: "worker", level: "fatal" }, {
      ...opts,
      release: "abc1234",
    });
    expect(event.level).toBe("fatal");
    expect(event.release).toBe("abc1234");
  });
});

describe("buildEnvelope", () => {
  const dsn = parseSentryDsn(DSN) as ParsedDsn;
  const event = { event_id: "0123456789abcdef0123456789abcdef", message: "hello" };

  it("frames the envelope as header / item header / payload, newline-delimited", () => {
    const raw = buildEnvelope(dsn, event, 1_700_000_000_000);
    const lines = raw.split("\n");
    expect(lines).toHaveLength(4); // trailing newline yields a final empty entry
    expect(lines[3]).toBe("");

    expect(JSON.parse(lines[0])).toEqual({
      event_id: "0123456789abcdef0123456789abcdef",
      sent_at: "2023-11-14T22:13:20.000Z",
      dsn: DSN,
    });
    expect(JSON.parse(lines[1])).toEqual({
      type: "event",
      content_type: "application/json",
      length: new TextEncoder().encode(lines[2]).length,
    });
    expect(JSON.parse(lines[2])).toEqual(event);
  });

  it("measures the item length in UTF-8 BYTES, not characters", () => {
    // The bug this guards: the app's user-facing text is Azerbaijani, so a real
    // error message is routinely multi-byte. A character count under-reports the
    // payload and Sentry drops the envelope.
    const azEvent = { event_id: "a".repeat(32), message: "Vaxt təsdiqlənmədi — çətinlik" };
    const lines = buildEnvelope(dsn, azEvent, 0).split("\n");
    const declared = JSON.parse(lines[1]).length as number;
    expect(declared).toBe(new TextEncoder().encode(lines[2]).length);
    expect(declared).toBeGreaterThan(lines[2].length);
  });

  it("survives a circular reference in extra rather than throwing", () => {
    const circular: Record<string, unknown> = { name: "req" };
    circular.self = circular;
    const raw = buildEnvelope(dsn, { event_id: "b".repeat(32), extra: circular }, 0);
    const payload = JSON.parse(raw.split("\n")[2]);
    expect(payload.extra.self).toBe("[Circular]");
  });
});

describe("errorFingerprint", () => {
  it("is stable for the same error from the same site", () => {
    const make = () => {
      const e = new Error("connect ETIMEDOUT");
      e.stack = "Error: connect ETIMEDOUT\n    at send (/app/src/lib/whatsapp.ts:78:20)";
      return e;
    };
    expect(errorFingerprint(make(), { source: "worker" })).toBe(
      errorFingerprint(make(), { source: "worker" }),
    );
  });

  it("separates the same message raised from different sources", () => {
    const err = new Error("boom");
    expect(errorFingerprint(err, { source: "worker" })).not.toBe(
      errorFingerprint(err, { source: "onRequestError" }),
    );
  });
});

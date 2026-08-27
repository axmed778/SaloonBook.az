// Error reporting that reaches a human.
//
// Until this file existed the only trace of a production error was a
// console.error line in Railway's log stream — which nobody reads at 2am. The
// structured logs stay exactly as they were (they remain the source of truth
// and the thing you grep during an incident); this module is the *push* half:
// it forwards the same error to Sentry and/or a chat webhook so somebody
// actually finds out.
//
// Deliberately dependency-free. Sentry's SDK is a large install that patches
// globals in three runtimes (node, edge, browser) and we need exactly one thing
// from it: POST a valid envelope. That is ~40 lines of fetch, so we do it here
// rather than take the dependency.
//
// Configuration (all optional — with none of it set this module is INERT and
// only the existing console.error output happens):
//   SENTRY_DSN             server-side DSN, https://<publicKey>@<host>/<projectId>
//   NEXT_PUBLIC_SENTRY_DSN same DSN, exposed to the browser bundle so the client
//                          error boundaries can report too. A DSN's key is
//                          public by design — it is write-only ingest.
//   ALERT_WEBHOOK_URL      server-only. Any hook that accepts a JSON POST with a
//                          `text` field (Slack incoming webhooks, Telegram
//                          bridges, Discord with /slack). NEVER exposed to the
//                          browser — see webhookFromEnv().

import { HTTP_TIMEOUT_MS } from "./http";

/** Where the error came from, plus anything that helps identify it later. */
export interface ErrorContext {
  /** Short stable label for the call site: "onRequestError", "worker", … */
  source: string;
  /** Indexed, searchable key/value pairs. Nullish entries are dropped. */
  tags?: Record<string, string | number | null | undefined>;
  /** Free-form payload attached to the event body. */
  extra?: Record<string, unknown>;
  /** Sentry level. Defaults to "error". */
  level?: "fatal" | "error" | "warning" | "info";
}

export interface ParsedDsn {
  /** The DSN as configured — the envelope header echoes it back. */
  dsn: string;
  publicKey: string;
  projectId: string;
  /** Fully-qualified envelope endpoint to POST to. */
  ingestUrl: string;
}

export interface StackFrame {
  filename: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

// ── DSN ────────────────────────────────────────────────────────────────────

/**
 * `https://<publicKey>@<host>/<projectId>` -> the envelope endpoint.
 *
 * Self-hosted Sentry can serve from a sub-path (`/sentry/<projectId>`), so the
 * project id is the LAST path segment and everything before it is a prefix that
 * has to survive into the ingest URL. Returns null for anything unparseable — a
 * typo in an env var must not throw inside an error handler.
 */
export function parseSentryDsn(raw: string | undefined | null): ParsedDsn | null {
  if (!raw || raw.trim() === "") return null;
  const trimmed = raw.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  // A legacy DSN is `<publicKey>:<secretKey>@…`; only the public half is used.
  const publicKey = decodeURIComponent(url.username);
  if (publicKey === "") return null;

  const segments = url.pathname.split("/").filter((s) => s !== "");
  const projectId = segments.pop();
  if (!projectId) return null;
  const prefix = segments.length > 0 ? `/${segments.join("/")}` : "";

  return {
    dsn: trimmed,
    publicKey,
    projectId,
    ingestUrl: `${url.protocol}//${url.host}${prefix}/api/${projectId}/envelope/`,
  };
}

/** The `X-Sentry-Auth` header. Protocol version 7 is what current Sentry speaks. */
export function sentryAuthHeader(dsn: ParsedDsn): string {
  return `Sentry sentry_version=7, sentry_client=salonbook/1.0, sentry_key=${dsn.publicKey}`;
}

// ── Event construction ─────────────────────────────────────────────────────

const MAX_FRAMES = 20;

// `at fn (file:line:col)` and the bare `at file:line:col` form. The location is
// anchored to the end of the line on purpose: a Windows path contains a colon of
// its own, so only a right-anchored match splits it correctly.
const FRAME_RE = /^\s*at (?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?\s*$/;

/**
 * V8 stack text -> Sentry frames. Sentry renders frames oldest-first (the
 * throwing frame last), which is the reverse of how V8 prints them.
 */
export function parseStackFrames(stack: string | undefined | null): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const line of stack.split("\n")) {
    const m = FRAME_RE.exec(line);
    if (!m) continue; // header line ("TypeError: x"), "at native", etc.
    const [, fn, filename, lineno, colno] = m;
    frames.push({
      filename,
      ...(fn ? { function: fn } : {}),
      lineno: Number(lineno),
      colno: Number(colno),
      // Our own code vs. dependencies/runtime — this is what drives Sentry's
      // suspect-commit guess and its collapsed-frames UI.
      in_app: !filename.includes("node_modules") && !filename.startsWith("node:"),
    });
    if (frames.length >= MAX_FRAMES) break;
  }
  return frames.reverse();
}

export interface SentryEventOptions {
  eventId: string;
  timestampMs: number;
  environment: string;
  /** "node" on the server, "javascript" in the browser. */
  platform?: string;
  release?: string;
}

/** The event body of the envelope. Pure — no clock, no env, no network. */
export function buildSentryEvent(
  err: Error,
  context: ErrorContext,
  opts: SentryEventOptions,
): Record<string, unknown> {
  const tags: Record<string, string> = { source: context.source };
  for (const [key, value] of Object.entries(context.tags ?? {})) {
    if (value === null || value === undefined || value === "") continue;
    tags[key] = String(value);
  }

  return {
    event_id: opts.eventId,
    timestamp: Math.floor(opts.timestampMs / 1000),
    platform: opts.platform ?? "node",
    level: context.level ?? "error",
    environment: opts.environment,
    logger: context.source,
    ...(opts.release ? { release: opts.release } : {}),
    tags,
    extra: context.extra ?? {},
    exception: {
      values: [
        {
          type: err.name || "Error",
          value: err.message,
          stacktrace: { frames: parseStackFrames(err.stack) },
        },
      ],
    },
  };
}

/**
 * Newline-delimited envelope framing:
 *
 *   <envelope header>\n<item header>\n<payload>\n
 *
 * The item header's `length` is the payload's UTF-8 BYTE length, not its
 * character count — get that wrong with a non-ASCII message (this app's user
 * messages are Azerbaijani) and Sentry rejects the whole envelope.
 */
export function buildEnvelope(
  dsn: ParsedDsn,
  event: Record<string, unknown>,
  sentAtMs: number,
): string {
  const payload = JSON.stringify(event, circularSafeReplacer());
  const length = new TextEncoder().encode(payload).length;
  const envelopeHeader = JSON.stringify({
    event_id: event.event_id,
    sent_at: new Date(sentAtMs).toISOString(),
    dsn: dsn.dsn,
  });
  const itemHeader = JSON.stringify({
    type: "event",
    content_type: "application/json",
    length,
  });
  return `${envelopeHeader}\n${itemHeader}\n${payload}\n`;
}

// `extra` is caller-supplied and can hold a Prisma client, a request object,
// anything — a circular reference there would throw inside the error handler.
function circularSafeReplacer(): (key: string, value: unknown) => unknown {
  const seen = new WeakSet<object>();
  return (_key, value) => {
    if (typeof value === "bigint") return value.toString();
    if (typeof value !== "object" || value === null) return value;
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
    return value;
  };
}

// ── Flood control ──────────────────────────────────────────────────────────

const RATE_WINDOW_MS = 60_000;
/** Per distinct error, per window. Enough to see it, not enough to drown in it. */
const MAX_PER_FINGERPRINT = 3;
/** Hard ceiling across all errors, so a storm of *different* errors is bounded too. */
const MAX_PER_WINDOW = 20;
/** Bounds the map even when every error is unique (e.g. an id inside the message). */
const MAX_TRACKED_FINGERPRINTS = 500;

let windowStartedAt = 0;
let windowTotal = 0;
let windowSuppressed = 0;
const windowCounts = new Map<string, number>();

/** Stable identity for "the same error again" — the key the rate limiter counts. */
export function errorFingerprint(err: Error, context: ErrorContext): string {
  const frames = parseStackFrames(err.stack);
  const top = frames[frames.length - 1];
  const site = top ? `${top.filename}:${top.lineno}` : "";
  return `${context.source}|${err.name}|${err.message}|${site}`.slice(0, 300);
}

/**
 * In-process token bucket. One hot loop (a retry storm, a poisoned job) would
 * otherwise fire one webhook message per iteration and get the hook rate-limited
 * exactly when it matters. Per-process is the right scope: each Railway replica
 * gets its own budget and there is no shared state to keep consistent.
 */
function admit(fingerprint: string, nowMs: number): boolean {
  if (nowMs - windowStartedAt >= RATE_WINDOW_MS) {
    if (windowSuppressed > 0) {
      console.warn(
        `[observability] suppressed ${windowSuppressed} duplicate error report(s) in the last minute`,
      );
    }
    windowStartedAt = nowMs;
    windowTotal = 0;
    windowSuppressed = 0;
    windowCounts.clear();
  }

  const seen = windowCounts.get(fingerprint) ?? 0;
  if (seen >= MAX_PER_FINGERPRINT || windowTotal >= MAX_PER_WINDOW) {
    windowSuppressed += 1;
    return false;
  }
  if (seen === 0 && windowCounts.size >= MAX_TRACKED_FINGERPRINTS) {
    windowSuppressed += 1;
    return false;
  }

  windowCounts.set(fingerprint, seen + 1);
  windowTotal += 1;
  return true;
}

// ── Environment ────────────────────────────────────────────────────────────

const isBrowser = (): boolean => typeof window !== "undefined";

function dsnFromEnv(): string | undefined {
  // Literal member accesses on purpose: Next substitutes only NEXT_PUBLIC_* into
  // the client bundle, and only for static `process.env.NAME` reads — a dynamic
  // `process.env[name]` lookup is silently undefined in the browser.
  const publicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (isBrowser()) return publicDsn;
  return process.env.SENTRY_DSN || publicDsn;
}

// Server-only on purpose. A chat webhook URL IS the credential — anyone holding
// it can post into the channel — so it must never reach a browser bundle.
function webhookFromEnv(): string | undefined {
  if (isBrowser()) return undefined;
  return process.env.ALERT_WEBHOOK_URL;
}

function environmentName(): string {
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

function releaseName(): string | undefined {
  if (isBrowser()) return undefined;
  const sha = process.env.RAILWAY_GIT_COMMIT_SHA;
  return sha ? sha.slice(0, 7) : undefined;
}

/** 32 lowercase hex chars — the shape Sentry wants (a UUID without its dashes). */
function newEventId(): string {
  const bytes = new Uint8Array(16);
  const webcrypto = globalThis.crypto;
  if (webcrypto && typeof webcrypto.getRandomValues === "function") {
    webcrypto.getRandomValues(bytes);
  } else {
    // Uniqueness is all that matters here — an event id is not a secret.
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Transports ─────────────────────────────────────────────────────────────

async function sendToSentry(
  dsn: ParsedDsn,
  err: Error,
  context: ErrorContext,
  eventId: string,
  nowMs: number,
): Promise<void> {
  try {
    const event = buildSentryEvent(err, context, {
      eventId,
      timestampMs: nowMs,
      environment: environmentName(),
      platform: isBrowser() ? "javascript" : "node",
      release: releaseName(),
    });
    const res = await fetch(dsn.ingestUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-sentry-envelope",
        "X-Sentry-Auth": sentryAuthHeader(dsn),
      },
      body: buildEnvelope(dsn, event, nowMs),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      // Never rethrow: a rejected ingest is a monitoring problem, not a request
      // problem, and the structured log already carries the real error.
      console.error(`[observability] sentry ingest ${res.status}`);
    }
  } catch (e) {
    console.error("[observability] sentry ingest failed", e instanceof Error ? e.message : e);
  }
}

async function sendToWebhook(
  url: string,
  err: Error,
  context: ErrorContext,
  eventId: string,
): Promise<void> {
  try {
    const tagLine = Object.entries(context.tags ?? {})
      .filter(([, v]) => v !== null && v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${String(v)}`)
      .join(" ");
    const firstFrame = (err.stack ?? "").split("\n")[1]?.trim() ?? "";
    const text = [
      `SalonBook ${environmentName()} — ${context.level ?? "error"} in ${context.source}`,
      `${err.name}: ${err.message}`.slice(0, 500),
      tagLine,
      firstFrame,
    ]
      .filter((line) => line !== "")
      .join("\n");

    // `text` is what Slack/Discord/Telegram-bridge hooks render; the sibling
    // fields are there for anything that parses the body instead.
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        event_id: eventId,
        source: context.source,
        level: context.level ?? "error",
        environment: environmentName(),
        message: err.message,
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[observability] alert webhook ${res.status}`);
    }
  } catch (e) {
    console.error("[observability] alert webhook failed", e instanceof Error ? e.message : e);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Forward an error to whichever reporters are configured. NEVER throws and never
 * rejects: every call site is already in a failure path, and an exception raised
 * here would replace a handled error with an unhandled one.
 *
 * Returns a promise so a caller that is about to exit the process (the worker's
 * fatal handler) can await delivery; everyone else should `void` it and move on.
 */
export async function captureError(error: unknown, context: ErrorContext): Promise<void> {
  try {
    const dsn = parseSentryDsn(dsnFromEnv());
    const webhook = webhookFromEnv();
    // Inert until an operator sets SENTRY_DSN and/or ALERT_WEBHOOK_URL. Checked
    // before the rate limiter so an unconfigured deploy never burns its budget.
    if (!dsn && !webhook) return;

    const err = error instanceof Error ? error : new Error(String(error));
    const nowMs = Date.now();
    if (!admit(errorFingerprint(err, context), nowMs)) return;

    const eventId = newEventId();
    const sends: Promise<void>[] = [];
    if (dsn) sends.push(sendToSentry(dsn, err, context, eventId, nowMs));
    if (webhook) sends.push(sendToWebhook(webhook, err, context, eventId));
    await Promise.allSettled(sends);
  } catch {
    // Absolutely nothing escapes the error reporter.
  }
}

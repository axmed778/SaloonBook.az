import IORedis from "ioredis";
import { redisUrl } from "./redis";

// Dedicated ioredis client for rate limiting / abuse counters. Kept separate
// from the BullMQ `connection` (which uses maxRetriesPerRequest: null) so app
// commands and the queue don't share request semantics. Still ioredis — no new
// dependency.
// Rate limiting is best-effort and fails open, so every wait must be bounded:
// without these timeouts an unreachable/slow Redis (e.g. a misconfigured prod
// URL) makes ioredis retry for 8–30s, adding that delay to every /availability
// and /book request. These caps keep a Redis outage to well under a second while
// still using it normally when it's healthy (internal Redis answers in ~ms).
const rl = new IORedis(redisUrl, {
  lazyConnect: true,
  connectTimeout: 1000,
  commandTimeout: 1000,
  maxRetriesPerRequest: 1,
  // The key one: when the client isn't connected, reject commands immediately
  // instead of buffering them in an offline queue that waits (indefinitely) for
  // a connection. Without this, commandTimeout doesn't help — a command that is
  // never sent is never timed out — which is why an unreachable Redis still
  // added ~8s per request. The connection is still (re)attempted in the
  // background, so rate limiting resumes automatically once Redis is reachable.
  enableOfflineQueue: false,
  retryStrategy: (times) => Math.min(times * 200, 2000),
  // Railway private network is IPv6-only — see note in src/lib/redis.ts.
  family: 0,
});
// Swallow connection errors here; rateLimit() fails open and logs per-call, so
// we don't want unhandled 'error' events tearing down the process.
rl.on("error", () => {});

/**
 * Lightweight Redis connectivity check for /api/health. Ensures a connection is
 * being attempted (lazyConnect + offlineQueue:false would otherwise just fail
 * the first command fast), waits briefly for readiness, then PINGs. Never throws.
 */
export async function redisPing(): Promise<boolean> {
  try {
    if (rl.status === "wait" || rl.status === "end") rl.connect().catch(() => {});
    const start = Date.now();
    while (rl.status !== "ready" && Date.now() - start < 1500) {
      await new Promise((r) => setTimeout(r, 50));
    }
    if (rl.status !== "ready") return false;
    const res = await Promise.race([
      rl.ping(),
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
    ]);
    return res === "PONG";
  } catch {
    return false;
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Remaining permits in the current window (>= 0). */
  remaining: number;
  /** Seconds until the window resets. */
  resetSec: number;
}

/**
 * Fixed-window counter: increments `key` and expires it after `windowSec`.
 * Returns allowed=false once the count exceeds `limit` within the window.
 *
 * Fail-open: if Redis is unreachable we allow the request rather than take the
 * whole booking flow down. Abuse protection is best-effort, not a correctness
 * guarantee (the DB constraints + plan limits are the hard guarantees).
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<RateLimitResult> {
  const redisKey = `rl:${key}`;
  try {
    const count = await rl.incr(redisKey);
    if (count === 1) {
      await rl.expire(redisKey, windowSec);
    }
    const ttl = await rl.ttl(redisKey);
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      resetSec: ttl >= 0 ? ttl : windowSec,
    };
  } catch (e) {
    console.error("[ratelimit] redis error, failing open", e);
    return { allowed: true, remaining: limit, resetSec: windowSec };
  }
}

/**
 * Hard cap on how many outbound notifications may target a single phone within
 * a rolling window. Unlike rateLimit, this is only consumed AFTER a booking is
 * accepted (one booking => confirmation + reminder to the same phone), so the
 * counter tracks delivered intent, not request attempts. Returns false if the
 * cap is already reached (caller should refuse to enqueue/book).
 */
export async function consumeOutboundQuota(
  phone: string,
  max: number,
  windowSec: number,
): Promise<boolean> {
  const redisKey = `out:${phone}`;
  try {
    const count = await rl.incr(redisKey);
    if (count === 1) {
      await rl.expire(redisKey, windowSec);
    }
    return count <= max;
  } catch (e) {
    console.error("[ratelimit] outbound quota redis error, failing open", e);
    return true;
  }
}

/**
 * Read-only check of the outbound quota WITHOUT consuming a permit. Used to gate
 * a booking BEFORE it is attempted: a failed attempt (slot taken, validation,
 * 500) must cost nothing, otherwise a customer retrying a just-taken slot would
 * burn their own daily quota and lock themselves out of legitimate
 * notifications. The permit is only consumed (consumeOutboundQuota) once a
 * booking actually succeeds. Returns true when still under the cap.
 *
 * Fail-open: a Redis error allows the request (abuse protection is best-effort).
 */
export async function peekOutboundQuota(phone: string, max: number): Promise<boolean> {
  const redisKey = `out:${phone}`;
  try {
    const raw = await rl.get(redisKey);
    const count = raw ? Number.parseInt(raw, 10) || 0 : 0;
    return count < max;
  } catch (e) {
    console.error("[ratelimit] outbound quota peek redis error, failing open", e);
    return true;
  }
}

/**
 * Best-effort client IP from proxy headers. Railway/Cloudflare sit in front, so
 * trust the left-most x-forwarded-for entry, then x-real-ip. Never throws.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

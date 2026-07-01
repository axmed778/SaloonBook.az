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
  retryStrategy: (times) => Math.min(times * 200, 2000),
});
// Swallow connection errors here; rateLimit() fails open and logs per-call, so
// we don't want unhandled 'error' events tearing down the process.
rl.on("error", () => {});

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

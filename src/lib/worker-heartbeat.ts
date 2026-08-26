// Liveness signal for the worker process.
//
// The worker is a separate Railway service with no healthcheck of its own —
// Railway only healthchecks the web service. So when the worker dies it dies
// quietly: restartPolicyMaxRetries is 10, after which Railway stops trying, and
// from then on nothing sends. Bookings still succeed, the dashboard still looks
// right, notification rows sit at QUEUED, and the first person to notice is a
// salon asking why customers stopped getting reminders.
//
// The worker writes a timestamp under a short TTL; the web service reads it.
// That gives /api/health and the admin panel a real answer to "is the worker
// running", using the Redis connection both sides already have — no new
// dependency, no new port, no polling between services.
import { appRedis } from "./ratelimit";

const KEY = "worker:heartbeat";

/** How often the worker refreshes the key. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

// Four missed beats before the key expires on its own. Wide enough that a slow
// GC pause or a brief Redis blip doesn't read as a dead worker.
const TTL_SEC = 120;

// Two missed beats is already suspicious, so report stale before the key expires
// — an ageing timestamp is more informative than a missing one.
const STALE_AFTER_SEC = 90;

export type WorkerLiveness = {
  /** "ok" beating; "stale" not beating; "unknown" Redis didn't answer. */
  state: "ok" | "stale" | "unknown";
  /** Seconds since the last beat, when known. */
  ageSec: number | null;
};

/** Called by the worker on boot and on an interval. Never throws. */
export async function writeWorkerHeartbeat(): Promise<void> {
  try {
    await appRedis.set(KEY, String(Date.now()), "EX", TTL_SEC);
  } catch {
    // Best-effort: a worker that can't reach Redis has bigger problems, and its
    // BullMQ connection will surface them.
  }
}

/**
 * Called by the web service. "unknown" is deliberately distinct from "stale":
 * if Redis is unreachable we cannot tell a dead worker from a healthy one, and
 * reporting that as dead would send someone chasing the wrong service.
 */
export async function readWorkerHeartbeat(): Promise<WorkerLiveness> {
  try {
    const raw = await appRedis.get(KEY);
    if (raw === null) return { state: "stale", ageSec: null };
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return { state: "unknown", ageSec: null };
    const ageSec = Math.max(0, Math.round((Date.now() - ts) / 1000));
    return { state: ageSec <= STALE_AFTER_SEC ? "ok" : "stale", ageSec };
  } catch {
    return { state: "unknown", ageSec: null };
  }
}

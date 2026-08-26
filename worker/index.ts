import { Queue, Worker } from "bullmq";
import { assertEnv } from "../src/lib/env";
import { connection } from "../src/lib/redis";
import { QUEUE_NAMES, type NotificationJob, type PushJob } from "../src/lib/queue";
import { processNotification } from "./processors/notifications";
import { processPush } from "./processors/push";
import { sweepSubscriptions } from "./processors/subscriptions";
import { sweepNotifications } from "./processors/notification-sweep";
import { reconcileOverdue } from "./processors/reconcile";
import { writeWorkerHeartbeat, HEARTBEAT_INTERVAL_MS } from "../src/lib/worker-heartbeat";

// The worker is a separate long-lived process (Railway "worker" service). It
// handles WhatsApp sending, scheduled reminders, and the nightly subscription
// sweep. Booking creation only enqueues jobs here and returns immediately.

// Validate THIS service's environment before opening any queue. Next's
// instrumentation hook only covers the web service, so until now the worker
// booted with any configuration at all — and a worker missing WHATSAPP_TOKEN
// logs every notification as sandbox and still records it SENT, which looks
// identical to a healthy send from the dashboard, the admin panel and the DB.
// Fail at boot, where it is visible, instead of days later via a salon asking
// why customers get nothing.
assertEnv("worker");

/**
 * Reads a polling interval (ms) from the environment, falling back to `fallback`.
 * `0` is a meaningful value: it disables the timer. Anything unparseable or
 * negative is ignored with a warning rather than silently disabling a sweep.
 *
 * These knobs exist because every tick of these timers is a query against
 * Postgres, and on a scale-to-zero database (Neon) the polling cadence — not
 * the query cost — is what decides whether the compute ever autosuspends.
 */
function intervalFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[worker] ${name}="${raw}" is not a non-negative number — using ${fallback}ms`);
    return fallback;
  }
  return parsed;
}

function describeInterval(ms: number): string {
  if (ms === 0) return "DISABLED";
  if (ms % 3_600_000 === 0) return `scheduled (every ${ms / 3_600_000}h)`;
  if (ms % 60_000 === 0) return `scheduled (every ${ms / 60_000} min)`;
  return `scheduled (every ${ms}ms)`;
}

const worker = new Worker<NotificationJob>(QUEUE_NAMES.notifications, processNotification, {
  connection,
  concurrency: 5,
});

worker.on("completed", (job) => console.log(`[worker] completed ${job.id}`));
worker.on("failed", (job, err) =>
  console.error(`[worker] failed ${job?.id}: ${err?.message}`),
);

console.log("[worker] notifications worker started");

// Web Push (PWA) worker: delivers new-booking / cancellation / reminder alerts
// to a salon's installed devices. Its own queue so push retries/backoff are
// independent of WhatsApp delivery.
const pushWorker = new Worker<PushJob>(QUEUE_NAMES.push, processPush, {
  connection,
  concurrency: 5,
});
pushWorker.on("failed", (job, err) =>
  console.error(`[worker] push failed ${job?.id}: ${err?.message}`),
);
console.log("[worker] push worker started");

// Subscription sweep: repeatable daily job (03:30 Baku = 23:30 UTC), plus one
// run at startup so a worker that was down over the boundary catches up.
const subsQueue = new Queue(QUEUE_NAMES.subscriptions, { connection });
const subsWorker = new Worker(QUEUE_NAMES.subscriptions, sweepSubscriptions, { connection });
subsWorker.on("failed", (job, err) =>
  console.error(`[worker] subscription sweep failed ${job?.id}: ${err?.message}`),
);

void (async () => {
  try {
    await subsQueue.upsertJobScheduler("subscription-sweep", { pattern: "30 23 * * *" });
    await subsQueue.add("sweep-on-boot", {});
    console.log("[worker] subscription sweep scheduled (daily 23:30 UTC)");
  } catch (e) {
    console.error("[worker] failed to schedule subscription sweep", e);
  }
})();

// Notification sweep: re-enqueue stuck QUEUED rows every 10 min (self-heals a
// Redis hiccup at enqueue time or a lost delayed reminder job). Runs in-process
// on a timer rather than as a delayed job, so triggering it doesn't itself
// depend on Redis scheduling surviving. One run at startup catches up quickly.
//
// COST NOTE (Neon): every tick is a `SELECT ... FROM Notification` against the
// database, so this timer alone is enough to wake a suspended compute forever.
// At the 10-minute default the compute wakes, serves one query, idles ~5 min,
// autosuspends, and is woken again ~5 min later — which is exactly the
// square-wave cache-hit pattern Neon's dashboard shows. Override with
// NOTIFICATION_SWEEP_INTERVAL_MS (e.g. 3600000 for hourly) to trade recovery
// latency for idle time; the sweep is a self-healing fallback, not the primary
// delivery path, so a longer interval only delays recovery from a Redis
// incident. Set to 0 to disable the timer entirely.
const SWEEP_INTERVAL_MS = intervalFromEnv("NOTIFICATION_SWEEP_INTERVAL_MS", 10 * 60_000);
void sweepNotifications().catch((e) =>
  console.error("[worker] initial notification sweep failed", e),
);
const sweepTimer =
  SWEEP_INTERVAL_MS > 0
    ? setInterval(() => {
        void sweepNotifications().catch((e) =>
          console.error("[worker] notification sweep failed", e),
        );
      }, SWEEP_INTERVAL_MS)
    : null;
console.log(`[worker] notification sweep ${describeInterval(SWEEP_INTERVAL_MS)}`);

// Reconcile sweep: auto-close (COMPLETED, autoCompleted=true) past CONFIRMED
// appointments the salon never reconciled after 48h, so the ROI dashboard and
// payroll don't read empty. Hourly is plenty — the cutoff is measured in days.
// Same cost note as the notification sweep: each tick is an UPDATE against the
// database. The cutoff is 48h, so hourly is already far more often than the
// feature needs — RECONCILE_INTERVAL_MS can safely be raised (e.g. 21600000 for
// every 6h). Set to 0 to disable the timer entirely.
const RECONCILE_INTERVAL_MS = intervalFromEnv("RECONCILE_INTERVAL_MS", 60 * 60_000);
void reconcileOverdue().catch((e) =>
  console.error("[worker] initial reconcile sweep failed", e),
);
const reconcileTimer =
  RECONCILE_INTERVAL_MS > 0
    ? setInterval(() => {
        void reconcileOverdue().catch((e) =>
          console.error("[worker] reconcile sweep failed", e),
        );
      }, RECONCILE_INTERVAL_MS)
    : null;
console.log(`[worker] reconcile sweep ${describeInterval(RECONCILE_INTERVAL_MS)}`);

// Liveness beat. Railway healthchecks the web service only, so without this a
// dead worker is invisible: after restartPolicyMaxRetries Railway stops trying,
// nothing sends again, and every other surface still looks healthy. The web
// service reads this key for /api/health and the admin panel.
void writeWorkerHeartbeat();
const heartbeatTimer = setInterval(() => void writeWorkerHeartbeat(), HEARTBEAT_INTERVAL_MS);
console.log("[worker] heartbeat started");

// A crash must not look like a clean exit. Log it in the same structured shape
// as the web service's onRequestError so both are searchable the same way, then
// let the process die so Railway restarts it — swallowing these would leave a
// worker alive but broken, which is worse than a restart.
function logFatal(kind: string, err: unknown): void {
  const e = err instanceof Error ? err : new Error(String(err));
  console.error(
    JSON.stringify({
      src: "worker",
      kind,
      ts: new Date().toISOString(),
      message: e.message,
      stack: e.stack?.split("\n").slice(0, 8).join(" | ") ?? null,
    }),
  );
}
process.on("uncaughtException", (e) => {
  logFatal("uncaughtException", e);
  process.exit(1);
});
process.on("unhandledRejection", (e) => {
  logFatal("unhandledRejection", e);
  process.exit(1);
});

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down...`);
  if (sweepTimer) clearInterval(sweepTimer);
  if (reconcileTimer) clearInterval(reconcileTimer);
  clearInterval(heartbeatTimer);
  await Promise.all([
    worker.close(),
    pushWorker.close(),
    subsWorker.close(),
    subsQueue.close(),
  ]);
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

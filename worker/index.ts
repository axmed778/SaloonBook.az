import { Queue, Worker } from "bullmq";
import { connection } from "../src/lib/redis";
import { QUEUE_NAMES, type NotificationJob } from "../src/lib/queue";
import { processNotification } from "./processors/notifications";
import { sweepSubscriptions } from "./processors/subscriptions";
import { sweepNotifications } from "./processors/notification-sweep";

// The worker is a separate long-lived process (Railway "worker" service). It
// handles WhatsApp sending, scheduled reminders, and the nightly subscription
// sweep. Booking creation only enqueues jobs here and returns immediately.

const worker = new Worker<NotificationJob>(QUEUE_NAMES.notifications, processNotification, {
  connection,
  concurrency: 5,
});

worker.on("completed", (job) => console.log(`[worker] completed ${job.id}`));
worker.on("failed", (job, err) =>
  console.error(`[worker] failed ${job?.id}: ${err?.message}`),
);

console.log("[worker] notifications worker started");

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
const SWEEP_INTERVAL_MS = 10 * 60_000;
void sweepNotifications().catch((e) =>
  console.error("[worker] initial notification sweep failed", e),
);
const sweepTimer = setInterval(() => {
  void sweepNotifications().catch((e) =>
    console.error("[worker] notification sweep failed", e),
  );
}, SWEEP_INTERVAL_MS);
console.log("[worker] notification sweep scheduled (every 10 min)");

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down...`);
  clearInterval(sweepTimer);
  await Promise.all([worker.close(), subsWorker.close(), subsQueue.close()]);
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

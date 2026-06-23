import { Worker } from "bullmq";
import { connection } from "../src/lib/redis";
import { QUEUE_NAMES, type NotificationJob } from "../src/lib/queue";
import { processNotification } from "./processors/notifications";

// The worker is a separate long-lived process (Railway "worker" service). It
// handles WhatsApp sending and scheduled reminders. Booking creation only
// enqueues jobs here and returns immediately.

const worker = new Worker<NotificationJob>(QUEUE_NAMES.notifications, processNotification, {
  connection,
  concurrency: 5,
});

worker.on("completed", (job) => console.log(`[worker] completed ${job.id}`));
worker.on("failed", (job, err) =>
  console.error(`[worker] failed ${job?.id}: ${err?.message}`),
);

console.log("[worker] notifications worker started");

async function shutdown(signal: string) {
  console.log(`[worker] ${signal} received, shutting down...`);
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

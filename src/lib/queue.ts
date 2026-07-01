import { Queue } from "bullmq";
import { connection } from "./redis";

export const QUEUE_NAMES = {
  notifications: "notifications",
} as const;

export interface NotificationJob {
  notificationId: string;
}

// Lazily construct the Queue. Route/page modules import this file transitively,
// and `next build` evaluates those modules while collecting page data — a
// module-scope `new Queue()` opens a BullMQ/Redis connection at BUILD time,
// which made the build noisy and flaky (non-deterministic non-zero exit). The
// Queue is created on the first real enqueue (runtime) instead.
let queue: Queue<NotificationJob, void, "send"> | null = null;

function notificationsQueue(): Queue<NotificationJob, void, "send"> {
  if (!queue) {
    queue = new Queue<NotificationJob, void, "send">(QUEUE_NAMES.notifications, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return queue;
}

/**
 * Enqueue a persisted Notification row for delivery.
 * `delayMs` schedules it for later (used for the T-24h reminder).
 */
export async function enqueueNotification(notificationId: string, delayMs?: number): Promise<void> {
  await notificationsQueue().add(
    "send",
    { notificationId },
    delayMs ? { delay: delayMs } : undefined,
  );
}

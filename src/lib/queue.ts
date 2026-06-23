import { Queue } from "bullmq";
import { connection } from "./redis";

export const QUEUE_NAMES = {
  notifications: "notifications",
} as const;

export interface NotificationJob {
  notificationId: string;
}

export const notificationsQueue = new Queue<NotificationJob, void, "send">(
  QUEUE_NAMES.notifications,
  {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: "exponential", delay: 10_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    },
  },
);

/**
 * Enqueue a persisted Notification row for delivery.
 * `delayMs` schedules it for later (used for the T-24h reminder).
 */
export async function enqueueNotification(notificationId: string, delayMs?: number): Promise<void> {
  await notificationsQueue.add("send", { notificationId }, delayMs ? { delay: delayMs } : undefined);
}

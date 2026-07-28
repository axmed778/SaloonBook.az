import { Queue } from "bullmq";
import { connection } from "./redis";

export const QUEUE_NAMES = {
  notifications: "notifications",
  subscriptions: "subscriptions",
  push: "push",
} as const;

export interface NotificationJob {
  notificationId: string;
}

// Web Push (PWA) events. The job carries only the appointment id + event type;
// the worker resolves the salon's subscriptions and builds the message at send
// time (so a reschedule/cancel between enqueue and send is reflected).
export type PushEventType = "new_booking" | "booking_cancelled" | "reminder";
export interface PushJob {
  type: PushEventType;
  appointmentId: string;
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
    // jobId = notificationId dedupes the queue: if a job for this notification
    // already exists (e.g. a still-pending delayed reminder), a second enqueue
    // — such as the stuck-row sweep re-adding it — is ignored instead of
    // creating a duplicate that would send the same WhatsApp message twice.
    // Safe because a notification is only ever sent once: after it completes,
    // its row is SENT and no path re-enqueues it.
    { jobId: notificationId, ...(delayMs ? { delay: delayMs } : {}) },
  );
}

// Separate queue for Web Push so it has its own retry/backoff and never blocks
// (or is blocked by) the WhatsApp `notifications` queue. Lazily constructed for
// the same build-time reason as above.
let pushQueueRef: Queue<PushJob, void, "push"> | null = null;

function pushQueue(): Queue<PushJob, void, "push"> {
  if (!pushQueueRef) {
    pushQueueRef = new Queue<PushJob, void, "push">(QUEUE_NAMES.push, {
      connection,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: "exponential", delay: 10_000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      },
    });
  }
  return pushQueueRef;
}

/**
 * Enqueue a Web Push event for a salon's installed devices. `delayMs` schedules
 * it for later (used for the T-2h reminder). jobId = `type:appointmentId` dedupes
 * so a retried trigger can't double-send the same alert.
 */
export async function enqueuePush(job: PushJob, delayMs?: number): Promise<void> {
  await pushQueue().add("push", job, {
    jobId: `${job.type}:${job.appointmentId}`,
    ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
  });
}

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

/**
 * Total processor invocations after which the sweep stops reviving a failed
 * notification (see worker/processors/notification-sweep.ts). Rows at or above
 * this are dead letters: something is wrong with the message itself, not the
 * connection, and a human needs to look. The admin panel counts them.
 */
export const MAX_NOTIFICATION_ATTEMPTS = 24;

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
        // 8 attempts with exponential backoff from 10s spans ~21 minutes
        // (10+20+40+80+160+320+640s). At 5 it was ~2.5 minutes, which is
        // shorter than most provider incidents — a brief Graph API wobble
        // exhausted the retries and burned the notification.
        attempts: 8,
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

/**
 * Re-enqueue a notification whose job already ran out of attempts and left the
 * row FAILED (see worker/processors/notification-sweep.ts).
 *
 * Needs its own entry point because of how BullMQ treats jobId. enqueueNotification
 * deliberately uses jobId = notificationId to dedupe, but removeOnFail keeps the
 * exhausted job in the failed set under exactly that id — so re-adding it is
 * silently ignored and the row can never be retried, by the sweep or by hand.
 *
 * The revival id embeds the row's attempt count, which gives dedup where it is
 * wanted and none where it isn't: two sweep passes before the worker touches the
 * row produce the same id and collapse into one job, while a genuine new round
 * of attempts changes the count and so mints a fresh id.
 */
export async function reviveNotification(
  notificationId: string,
  attempts: number,
): Promise<void> {
  await notificationsQueue().add(
    "send",
    { notificationId },
    { jobId: `${notificationId}:r${attempts}` },
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

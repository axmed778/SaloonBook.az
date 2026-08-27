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
/**
 * Run a best-effort enqueue that can never hold a request open.
 *
 * A bare `await enqueue…()` is not safe on a user-facing path: with Redis
 * unreachable, ioredis parks the command in its offline queue and the promise
 * simply never settles, so a try/catch around it catches nothing and the staff
 * member's click hangs until the platform times the request out. Every row this
 * guards is already persisted QUEUED, and the sweep re-enqueues it later, so
 * losing the race costs nothing but a few minutes of latency on the message.
 */
export const ENQUEUE_TIMEOUT_MS = 2_000;

export async function bestEffortEnqueue(label: string, run: () => Promise<void>): Promise<void> {
  try {
    await Promise.race([
      run(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("enqueue timed out")), ENQUEUE_TIMEOUT_MS),
      ),
    ]);
  } catch (e) {
    console.error(`[${label}] enqueue failed/timed out (row persisted QUEUED)`, e);
  }
}

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

/**
 * Re-check a notification later, when it is due or when the claim another
 * worker holds on it expires (see worker/processors/notifications.ts).
 *
 * A third entry point, for the same jobId reason as reviveNotification: the
 * processor run that decides "not mine to send yet" completes its job, and a
 * completed job keeps its id (removeOnComplete keeps the last 1000), which would
 * make both the sweep's enqueueNotification and a second defer a silent no-op —
 * leaving a row that nothing ever picks up again. Bucketing the id by target
 * minute keeps the dedupe where it belongs: two runs aiming at the same moment
 * collapse into one job, a later re-check gets an id of its own.
 */
export async function deferNotification(notificationId: string, dueAt: Date): Promise<void> {
  const dueMs = dueAt.getTime();
  await notificationsQueue().add(
    "send",
    { notificationId },
    {
      jobId: `${notificationId}:w${Math.floor(dueMs / 60_000)}`,
      // +1s so the job lands after the row is genuinely due rather than on the
      // exact boundary, where it would defer itself once more.
      delay: Math.max(dueMs - Date.now(), 0) + 1_000,
    },
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
 * How far ahead of the appointment the salon's "upcoming visit" push fires.
 * Exported so the schedulers below and the booking path agree on one number.
 */
export const PUSH_REMINDER_LEAD_MS = 2 * 60 * 60_000;

// Re-scheduling a job that is already within a couple of minutes of its target
// is not worth a remove+add round trip; the alert is "about two hours before",
// not a timer.
const PUSH_REMINDER_DRIFT_MS = 2 * 60_000;

// Deterministic per (event, appointment): the id is what lets a pending delayed
// job be found again after a reschedule or a cancellation, and what dedupes a
// retried trigger.
function pushJobId(type: PushEventType, appointmentId: string): string {
  return `${type}:${appointmentId}`;
}

/**
 * Enqueue a Web Push event for a salon's installed devices. `delayMs` schedules
 * it for later (used for the T-2h reminder). jobId = `type:appointmentId` dedupes
 * so a retried trigger can't double-send the same alert.
 */
export async function enqueuePush(job: PushJob, delayMs?: number): Promise<void> {
  await pushQueue().add("push", job, {
    jobId: pushJobId(job.type, job.appointmentId),
    ...(delayMs && delayMs > 0 ? { delay: delayMs } : {}),
  });
}

/**
 * Make the pending T-2h push for an appointment match `startsAt`, moving it if
 * it is scheduled for the wrong time.
 *
 * Needed because the reminder is scheduled once, at booking time, from a start
 * time that a reschedule then changes: the salon was warned two hours before a
 * visit that is no longer happening then, and got nothing before the visit that
 * is. `enqueuePush` cannot fix that by itself — BullMQ silently IGNORES an add()
 * whose jobId already exists (including ids kept around by removeOnComplete /
 * removeOnFail), so the stale job has to be removed before the new one can take
 * its id.
 *
 * Safe to call repeatedly: a job already scheduled for the right moment is left
 * alone, and a reminder whose new time is less than the lead time away is simply
 * dropped — the same thing the booking path does for a booking made inside 2h,
 * rather than firing an "upcoming" alert the salon is already looking at.
 *
 * Every path that moves an appointment (the public manage page, the dashboard's
 * reschedule) should call this after the update commits; worker/processors/
 * push-sync.ts re-derives it from the database on a timer as the backstop.
 */
export async function syncPushReminder(appointmentId: string, startsAt: Date): Promise<void> {
  const q = pushQueue();
  const jobId = pushJobId("reminder", appointmentId);
  const fireAt = startsAt.getTime() - PUSH_REMINDER_LEAD_MS;

  const existing = await q.getJob(jobId);
  if (existing) {
    // What the job WILL fire at (or did): when it was added plus its delay.
    const scheduledFor = existing.timestamp + existing.delay;
    if (Math.abs(scheduledFor - fireAt) <= PUSH_REMINDER_DRIFT_MS) return;
    // remove() returns 0 for a locked job — one that is being delivered right
    // now. Nothing useful to do about that: the alert is already on its way, and
    // the next sync pass sees the finished job and re-schedules if still needed.
    if ((await q.remove(jobId)) === 0) return;
  }

  const delay = fireAt - Date.now();
  if (delay <= 0) return;
  await q.add("push", { type: "reminder", appointmentId }, { jobId, delay });
}

/**
 * Drop the pending T-2h push for an appointment (cancelled, or moved somewhere
 * the reminder no longer applies). No-op when the job is gone or already firing.
 */
export async function cancelPushReminder(appointmentId: string): Promise<void> {
  await pushQueue().remove(pushJobId("reminder", appointmentId));
}

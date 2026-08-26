import { prisma } from "../../src/lib/prisma";
import {
  enqueueNotification,
  reviveNotification,
  MAX_NOTIFICATION_ATTEMPTS,
} from "../../src/lib/queue";

// Re-enqueue notifications that will otherwise never send. Three ways that
// happens:
//   1) Redis hiccupped when booking/reschedule tried to enqueue after commit —
//      the row persisted QUEUED but no job was ever created.
//   2) Redis lost data — delayed T-24h reminder jobs live ONLY in Redis (for up
//      to weeks), so an eviction/restart drops them while the row stays QUEUED.
//   3) The job exhausted its attempts and the row went FAILED. Nothing picked
//      those up: this sweep only looked at QUEUED, and re-adding by hand was
//      silently swallowed because removeOnFail keeps the dead job under the same
//      jobId. A few minutes of Graph API trouble therefore burned every
//      confirmation and reminder in that window, permanently and invisibly —
//      the dashboard showed nothing wrong and only direct SQL could recover it.
//
// Safe to run repeatedly: the processor is idempotent (skips rows already
// SENT/DELIVERED/READ/CANCELLED), and the margins below avoid racing a healthy
// enqueue or a still-pending delayed job.

// Skip very fresh rows — the post-commit enqueue may still be in flight.
const CREATED_GRACE_MS = 5 * 60_000;
// Only rows overdue by a margin: a healthy delayed job fires at sendAfter and
// the processor flips the row to SENT within seconds, so anything still QUEUED
// well past its sendAfter is genuinely stuck, not merely in-progress.
const DUE_GRACE_MS = 2 * 60_000;
// Bound the work per pass; the next tick picks up the rest.
const BATCH = 500;
// Give up reviving a row after MAX_NOTIFICATION_ATTEMPTS total processor
// invocations. Each revival buys a fresh round of the queue's 8 attempts, so
// that allows roughly three rounds before the row is left alone as a genuine
// dead letter needing a human (a bad template, a number Meta rejects). Without a
// cap a permanently undeliverable row would be retried by every sweep, forever.
// A FAILED row is NOT necessarily finished: the processor writes FAILED on every
// failed attempt, not just the last one, so a row can sit FAILED while its job is
// still working through the queue's 8 attempts (~21 minutes). Reviving one then
// would put a second job on the same notification and send the message twice.
// Only consider a FAILED row abandoned once it has been due for longer than the
// whole retry window can last.
const FAILED_GRACE_MS = 30 * 60_000;
// Cap each enqueue: with Redis down, ioredis buffers the command in its offline
// queue and never resolves, so a bare await would hang the whole sweep. Match
// the booking/manage enqueue policy (time-bounded, best-effort).
const ENQUEUE_TIMEOUT_MS = 2_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("enqueue timed out")), ms),
    ),
  ]);
}

export async function sweepNotifications(): Promise<void> {
  const now = Date.now();
  const stuck = await prisma.notification.findMany({
    where: {
      createdAt: { lt: new Date(now - CREATED_GRACE_MS) },
      attempts: { lt: MAX_NOTIFICATION_ATTEMPTS },
      OR: [
        { status: "QUEUED", sendAfter: { lte: new Date(now - DUE_GRACE_MS) } },
        { status: "FAILED", sendAfter: { lte: new Date(now - FAILED_GRACE_MS) } },
      ],
    },
    // status and attempts drive which enqueue path a row takes — a QUEUED row
    // may still have a live delayed job and must keep the deduping jobId, while
    // a FAILED row needs a fresh one to get past the dead job holding that id.
    select: { id: true, status: true, attempts: true },
    orderBy: { sendAfter: "asc" },
    take: BATCH,
  });
  if (stuck.length === 0) return;
  if (stuck.length === BATCH) {
    console.log(`[sweep] batch cap (${BATCH}) reached — more stuck rows remain, next tick continues`);
  }

  let ok = 0;
  let revived = 0;
  for (const n of stuck) {
    try {
      // Due now (sendAfter already passed) — enqueue with no delay. Bounded so a
      // down Redis can't hang the sweep; jobId dedup (see enqueueNotification)
      // makes a later retry of a timed-out-but-eventually-buffered add safe.
      if (n.status === "FAILED") {
        // Deliberately NOT flipped back to QUEUED. The processor already accepts
        // a FAILED row (it only short-circuits on SENT/DELIVERED/READ/CANCELLED),
        // and rewriting the status here would either race the worker's own
        // update or, if the enqueue then failed, strand the row as QUEUED behind
        // the dead job still holding the deduping jobId — unreachable by either
        // branch. Leaving it FAILED keeps the next pass idempotent: same
        // attempts, same revival jobId, collapsed by BullMQ.
        await withTimeout(reviveNotification(n.id, n.attempts), ENQUEUE_TIMEOUT_MS);
        revived++;
      } else {
        await withTimeout(enqueueNotification(n.id), ENQUEUE_TIMEOUT_MS);
      }
      ok++;
    } catch (e) {
      // A timeout almost always means Redis is unreachable — the remaining rows
      // would fail the same way, so stop and let the next tick retry.
      console.error(`[sweep] enqueue failed for ${n.id}; aborting this pass`, e);
      break;
    }
  }
  console.log(
    `[sweep] re-enqueued ${ok}/${stuck.length} stuck notifications (${revived} revived from FAILED)`,
  );
}

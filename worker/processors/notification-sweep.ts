import { prisma } from "../../src/lib/prisma";
import { enqueueNotification } from "../../src/lib/queue";

// Re-enqueue notifications that are stuck in QUEUED. Two ways a row gets stuck:
//   1) Redis hiccupped when booking/reschedule tried to enqueue after commit —
//      the row persisted QUEUED but no job was ever created.
//   2) Redis lost data — delayed T-24h reminder jobs live ONLY in Redis (for up
//      to weeks), so an eviction/restart drops them while the row stays QUEUED.
// Without this sweep, confirmations/reminders would silently never send.
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
      status: "QUEUED",
      sendAfter: { lte: new Date(now - DUE_GRACE_MS) },
      createdAt: { lt: new Date(now - CREATED_GRACE_MS) },
    },
    select: { id: true },
    orderBy: { sendAfter: "asc" },
    take: BATCH,
  });
  if (stuck.length === 0) return;
  if (stuck.length === BATCH) {
    console.log(`[sweep] batch cap (${BATCH}) reached — more stuck rows remain, next tick continues`);
  }

  let ok = 0;
  for (const n of stuck) {
    try {
      // Due now (sendAfter already passed) — enqueue with no delay. Bounded so a
      // down Redis can't hang the sweep; jobId dedup (see enqueueNotification)
      // makes a later retry of a timed-out-but-eventually-buffered add safe.
      await withTimeout(enqueueNotification(n.id), ENQUEUE_TIMEOUT_MS);
      ok++;
    } catch (e) {
      // A timeout almost always means Redis is unreachable — the remaining rows
      // would fail the same way, so stop and let the next tick retry.
      console.error(`[sweep] enqueue failed for ${n.id}; aborting this pass`, e);
      break;
    }
  }
  console.log(`[sweep] re-enqueued ${ok}/${stuck.length} stuck QUEUED notifications`);
}

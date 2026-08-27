import { prisma } from "../../src/lib/prisma";
import {
  cancelPushReminder,
  syncPushReminder,
  PUSH_REMINDER_LEAD_MS,
} from "../../src/lib/queue";

// Keep the salon's T-2h "upcoming visit" push in step with the appointment.
//
// That push is scheduled once, at booking time, from the start time as it was
// then. A reschedule changes the start time in Postgres but cannot move a job
// that already sits in Redis, so the alert fires before a visit that is no
// longer happening and never fires before the one that is. The reschedule paths
// live in the web service and should call syncPushReminder directly; this pass
// is the backstop that makes the database the source of truth regardless — it
// also repairs jobs lost to a Redis restart, exactly as the notification sweep
// does for WhatsApp rows.
//
// Horizon: only appointments whose reminder is due to fire soon. A booking
// three weeks out with a stale job is left alone until it comes into range,
// which keeps the query small and means one pass fixes each appointment once.
const HORIZON_MS = 30 * 60_000;
// Bound the work per pass; the next tick picks up the rest.
const BATCH = 500;
// With Redis unreachable ioredis buffers commands in its offline queue and never
// resolves, so a bare await would hang the sweep this rides on.
const REDIS_TIMEOUT_MS = 2_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("push queue call timed out")), ms),
    ),
  ]);
}

export async function syncPushReminders(): Promise<void> {
  const now = Date.now();
  const appts = await prisma.appointment.findMany({
    where: {
      startsAt: { gt: new Date(now), lte: new Date(now + PUSH_REMINDER_LEAD_MS + HORIZON_MS) },
    },
    select: { id: true, status: true, startsAt: true },
    orderBy: { startsAt: "asc" },
    take: BATCH,
  });
  if (appts.length === 0) return;

  let moved = 0;
  let dropped = 0;
  for (const a of appts) {
    try {
      if (a.status === "CONFIRMED") {
        // No-op when the pending job already targets the right moment, so a
        // steady-state pass costs one Redis read per appointment.
        await withTimeout(syncPushReminder(a.id, a.startsAt), REDIS_TIMEOUT_MS);
        moved++;
      } else {
        // Cancelled/no-showed: processPush would drop the alert at send time
        // anyway, but removing the job now saves waking the worker (and the
        // database) for a message nobody will get.
        await withTimeout(cancelPushReminder(a.id), REDIS_TIMEOUT_MS);
        dropped++;
      }
    } catch (e) {
      // A timeout means Redis is unreachable; the rest of the batch would fail
      // the same way, so stop and let the next tick retry.
      console.error(`[push-sync] queue call failed for ${a.id}; aborting this pass`, e);
      break;
    }
  }
  console.log(`[push-sync] checked ${moved} upcoming, cleared ${dropped} inactive reminder(s)`);
}

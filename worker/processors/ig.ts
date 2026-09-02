import type { Job } from "bullmq";
import { prisma } from "../../src/lib/prisma";
import { fetchIgProfile } from "../../src/lib/instagram";
import { igAccessToken, refreshAndStoreIgToken } from "../../src/lib/ig-token";
import type { IgJob } from "../../src/lib/queue";

/**
 * Background work for Instagram Direct. Both job types are Graph calls that the
 * webhook must not make inline — it has ~2 seconds to answer Meta, and a Graph
 * round trip alone can eat most of that.
 */
export async function processIg(job: Job<IgJob>): Promise<void> {
  switch (job.data.type) {
    case "profile":
      return fillProfile(job.data.igUserId);
    case "token-refresh":
      return refreshToken();
    default:
      // A job enqueued by a newer deploy than this worker. Drop it rather than
      // failing: retrying an unknown shape cannot make it known.
      console.warn(`[worker:ig] unknown job type, skipping (job ${job.id})`);
  }
}

/**
 * Resolve an IGSID to a display name and @handle so the inbox shows a person
 * rather than a 17-digit id.
 *
 * The queue buckets these per lead per day (see enqueueIgProfile), and this
 * skips outright once a handle is known, so a busy conversation costs one Graph
 * call in total rather than one per message.
 */
async function fillProfile(igUserId: string): Promise<void> {
  const thread = await prisma.igThread.findUnique({
    where: { igUserId },
    select: { id: true, username: true },
  });
  // No thread means the webhook's write lost a race with this job, or the
  // thread was deleted. Either way there is nothing to fill in; the next
  // message re-enqueues.
  if (!thread) return;
  if (thread.username) return;

  const token = await igAccessToken();
  if (!token) {
    console.warn("[worker:ig] no access token configured — skipping profile lookup");
    return;
  }

  const profile = await fetchIgProfile(igUserId, token);
  if (!profile.username && !profile.name) return;

  // updateMany with the "still blank" filter, not update: two jobs for the same
  // lead must not overwrite each other, and a handle a human corrected by hand
  // outranks whatever Graph returns.
  await prisma.igThread.updateMany({
    where: { id: thread.id, username: null },
    data: {
      username: profile.username ?? null,
      name: profile.name ?? null,
    },
  });
  console.log(`[worker:ig] profile filled for thread ${thread.id}`);
}

/**
 * Monthly renewal of the 60-day long-lived token.
 *
 * Monthly rather than every 59 days on purpose: it leaves a full month of
 * margin, so a Graph outage, a worker that was down, or a run that failed all
 * its retries costs nothing at all. Once the token actually lapses there is no
 * programmatic recovery — it has to be re-issued through the app's login flow —
 * which is exactly the failure this margin exists to prevent.
 */
async function refreshToken(): Promise<void> {
  const expiresAt = await refreshAndStoreIgToken();
  if (!expiresAt) {
    console.warn("[worker:ig] no access token configured — nothing to refresh");
    return;
  }
  // The token itself is never logged, only when it now runs out.
  console.log(`[worker:ig] access token refreshed, valid until ${expiresAt.toISOString()}`);
}

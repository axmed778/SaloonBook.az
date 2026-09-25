// ---------------------------------------------------------------------------
// BullMQ custom job ids, built in one place because of a single rule that is
// easy to break and invisible until production: a jobId may not contain ":".
//
// BullMQ enforces it in Job.validateOptions — i.e. inside add() — so a colon is
// not a type error and not a lint warning. It is a thrown Error on the enqueue
// path, at runtime. The check has one legacy exception: an id of exactly three
// colon-separated parts is allowed, because that is the shape of the repeatable
// job ids older versions generated. That exception is why some of these ids
// appeared to work and others did not — `ig-profile:<igsid>:<day>` has two
// colons and passed, `<id>:r<n>` has one and threw.
//
// What the hand-written ids cost before this module existed:
//   * reviveNotification (`<id>:r<n>`) — the notification sweep threw on the
//     first FAILED row it met, and because the sweep aborts its pass on an
//     enqueue error, nothing behind that row was re-enqueued either. Production
//     logged "[sweep] re-enqueued 0/4 stuck notifications" every ten minutes.
//   * enqueuePush / syncPushReminder / cancelPushReminder
//     (`<type>:<appointmentId>`) — every Web Push enqueue threw. bullmq has been
//     pinned ^6.1.2 since the initial commit, so these never worked at all.
//   * deferNotification (`<id>:w<minute>`) — same, so a notification that was
//     not yet due could never re-check itself.
//
// Build every custom id through jobId() below; never interpolate one by hand.
// ---------------------------------------------------------------------------

/** Separator between the parts of a composite job id. Anything but ":". */
const SEP = "-";

/**
 * Join parts into a custom job id, with colons stripped.
 *
 * Sanitises rather than throws on purpose: the point of this module is that the
 * enqueue path can never fail again on the *shape* of an id. A part that carries
 * a colon of its own — an ISO timestamp is the obvious way that happens — turns
 * it into a separator, which keeps the id stable and unique instead of losing
 * the job.
 */
export function jobId(...parts: Array<string | number>): string {
  return parts.map((part) => String(part).split(":").join(SEP)).join(SEP);
}

/**
 * The deduping id for a notification's delivery job: the row's own id, so a
 * second enqueue for the same notification is collapsed by BullMQ instead of
 * sending the same WhatsApp message twice.
 */
export function notificationJobId(notificationId: string): string {
  return jobId(notificationId);
}

/**
 * The id for reviving a notification whose job exhausted its attempts.
 *
 * Embeds the attempt count, which puts dedup exactly where it is wanted: two
 * sweep passes before the worker touches the row mint the same id and collapse,
 * while a genuine new round of attempts changes the count and gets a fresh id
 * (needed because removeOnFail keeps the dead job under the plain id).
 */
export function reviveJobId(notificationId: string, attempts: number): string {
  return jobId(notificationId, `r${attempts}`);
}

/**
 * The id for re-checking a notification later. Bucketed by target minute: two
 * runs aiming at the same moment collapse into one job, a later re-check gets an
 * id of its own (a completed job keeps its id, so the plain id would be a silent
 * no-op).
 */
export function deferJobId(notificationId: string, dueAt: Date): string {
  return jobId(notificationId, `w${Math.floor(dueAt.getTime() / 60_000)}`);
}

/** The deduping id for a Web Push event, so a retried trigger can't double-send. */
export function pushJobId(type: string, appointmentId: string): string {
  return jobId(type, appointmentId);
}

/**
 * The id for an Instagram profile lookup, bucketed by UTC day: a chatty lead
 * costs one Graph call an afternoon, while a lookup that failed all day still
 * gets a fresh attempt tomorrow.
 */
export function igProfileJobId(igUserId: string, now: Date = new Date()): string {
  return jobId("ig-profile", igUserId, Math.floor(now.getTime() / 86_400_000));
}

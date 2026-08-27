import type { Job } from "bullmq";
import type { NotifStatus } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { sendWhatsAppTemplate } from "../../src/lib/whatsapp";
import { resolveWhatsAppSender } from "../../src/lib/whatsapp-sender";
import { buildComponents } from "../../src/lib/whatsapp-templates";
import { deferNotification, type NotificationJob } from "../../src/lib/queue";
import { messagingStillPermitted } from "../consent";

const DONE = new Set(["SENT", "DELIVERED", "READ"]);
// Statuses a row may still be sent FROM. FAILED is included on purpose: the
// sweep revives exhausted rows and this processor is what retries them.
const SENDABLE: NotifStatus[] = ["QUEUED", "FAILED"];

// A claim reserves the row for this run by pushing sendAfter into the future.
// The schema has no SENDING status and we do not own it, but sendAfter already
// means "not before", so a lease expressed in it is honored by every reader
// (this processor and the stuck-row sweep) without a migration.
//
// The lease is what makes the send idempotent. Claiming before sending is not
// enough on its own: if the Graph call succeeds and the terminal write then
// hits a database blip, BullMQ retries the job, and a processor able to
// re-claim immediately would send the customer a second identical message.
// Inside the lease window the retry sees a row that is not due and leaves it.
//
// 10 minutes: comfortably longer than any single send (the Graph call takes
// seconds), short enough that a worker killed between claim and terminal write
// is picked up by the very next sweep pass instead of being stranded forever.
const CLAIM_LEASE_MS = 10 * 60_000;
// A delayed job can fire a hair before its sendAfter (clock skew between the web
// service that computed the delay and the worker). Without this tolerance such a
// row would look "not due yet", be skipped, and only go out on the next sweep.
const CLAIM_SKEW_MS = 60_000;

export async function processNotification(job: Job<NotificationJob>): Promise<void> {
  const { notificationId } = job.data;

  const n = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      appointment: {
        select: {
          status: true,
          endsAt: true,
          manageToken: true,
          source: true,
          consentAt: true,
          salon: { select: { slug: true } },
          // Live marketing consent, for the send-time re-check below.
          customer: { select: { waOptIn: true } },
        },
      },
    },
  });
  if (!n) return;
  if (DONE.has(n.status)) return; // idempotent: already sent
  if (n.status === "CANCELLED") return; // cancelled while queued (e.g. by setAppointmentStatus)

  // Re-check the appointment at send time: a reminder queued at booking time
  // must never fire for an appointment that was since cancelled or no-showed.
  // (Delayed BullMQ jobs can't be reliably removed, so the guard lives here.)
  // Cancellation NOTICES are exempt — they exist precisely because the
  // appointment is cancelled.
  const isCancellationNotice =
    n.template === "appointment_cancelled" || n.template === "booking_cancelled_alert";
  const apptStatus = n.appointment?.status;
  if ((apptStatus === "CANCELLED" || apptStatus === "NO_SHOW") && !isCancellationNotice) {
    await finalize(n.id, { status: "CANCELLED" });
    return;
  }

  // Nor may it fire for an appointment that is already over. This matters now
  // that the sweep revives FAILED rows: a provider outage long enough to exhaust
  // the retries can be followed, hours later, by a batch of "your appointment is
  // tomorrow at 15:00" reminders for visits that already happened. Cancellation
  // notices are exempt for the same reason as above — they exist precisely
  // because the appointment isn't happening.
  if (!isCancellationNotice && n.appointment && n.appointment.endsAt <= new Date()) {
    await finalize(n.id, { status: "CANCELLED", lastError: "appointment already ended" });
    return;
  }

  // Consent can be withdrawn between enqueue and send — a customer who replies
  // STOP today must not get tomorrow morning's reminder. CANCELLED (not FAILED)
  // because this is a decision, not a delivery problem: it must not be retried,
  // revived by the sweep, or counted as a broken send in the admin panel. The
  // reason string is what tells it apart from the guards above.
  if (!(await messagingStillPermitted(n))) {
    await finalize(n.id, { status: "CANCELLED", lastError: "recipient opted out" });
    return;
  }

  if (n.sendAfter.getTime() > Date.now() + CLAIM_SKEW_MS) {
    // Either another run holds the lease or this job fired early. Both mean "not
    // ours to send now" — book a fresh look for when the row is due instead of
    // sending. Deferring explicitly (rather than leaving it to the sweep) is
    // required: this job is about to COMPLETE holding the deduping jobId, which
    // would make the sweep's re-enqueue a silent no-op.
    await deferNotification(n.id, n.sendAfter);
    return;
  }
  // Claim the row before anything leaves the process. Guarding on the exact
  // (status, attempts) pair we just read makes this a compare-and-set: a second
  // worker holding the same snapshot updates 0 rows and backs off, so the same
  // message can never be sent twice concurrently.
  const claim = await prisma.notification.updateMany({
    where: { id: n.id, status: { in: SENDABLE }, attempts: n.attempts },
    data: {
      // Counted at claim time rather than at the terminal write, so a run that
      // dies mid-send still burns an attempt and a permanently wedged row
      // eventually reaches MAX_NOTIFICATION_ATTEMPTS instead of cycling forever.
      attempts: { increment: 1 },
      sendAfter: new Date(Date.now() + CLAIM_LEASE_MS),
    },
  });
  if (claim.count === 0) return; // lost the race, or the row moved on meanwhile

  let sender: Awaited<ReturnType<typeof resolveWhatsAppSender>>;
  let res: Awaited<ReturnType<typeof sendWhatsAppTemplate>>;
  try {
    // Resolve which number this salon sends from: its own (PRO + ACTIVE own-number
    // sender) or the shared platform number. Never throws — falls back to platform.
    sender = await resolveWhatsAppSender(n.salonId);

    res = await sendWhatsAppTemplate({
      toPhone: n.toPhone,
      template: n.template,
      languageCode: "az",
      token: sender.token,
      phoneNumberId: sender.phoneNumberId,
      components: buildComponents(
        n.template,
        n.payload,
        n.appointment
          ? { manageToken: n.appointment.manageToken, salonSlug: n.appointment.salon.slug }
          : null,
      ),
    });

    // Sandbox means nothing left the process (no token / phone number id).
    // Recording SENT would make an undelivered message indistinguishable from a
    // delivered one everywhere we look. Treat it as a retryable failure so the
    // row lands in FAILED with a readable reason. assertEnv("worker") should
    // stop production from reaching this, so this is the second lock — and it
    // still allows sandbox in dev, where SENT is the useful outcome.
    if (res.sandbox && process.env.NODE_ENV === "production") {
      throw new Error(
        "WhatsApp sender is in sandbox mode (WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID " +
          "missing for this salon's sender) — refusing to record an unsent message as SENT",
      );
    }

  } catch (e) {
    // Best-effort: if even this write fails the row stays QUEUED under its lease
    // and the retry re-sends once the lease lapses — losing the original error
    // by throwing from here would only hide why.
    await finalize(n.id, {
      status: "FAILED",
      lastError: e instanceof Error ? e.message : String(e),
      sendAfter: n.sendAfter,
    }).catch((writeErr) =>
      console.error(`[worker] could not record failure for ${n.id}`, writeErr),
    );
    throw e; // let BullMQ retry with backoff
  }

  // Outside the try on purpose: the message is already out, so a database
  // problem here is NOT a send failure and must never be recorded as one. It
  // throws instead, and the claim lease is what stops the ensuing retry from
  // sending the customer the same message a second time.
  await finalize(n.id, {
    status: "SENT",
    providerMsgId: res.providerMsgId ?? null,
    // Stamp the sending number so inbound status webhooks can be scoped to
    // the owning salon (null in sandbox/platform-unset — the wamid still
    // uniquely identifies the row).
    phoneNumberId: sender.phoneNumberId ?? null,
    lastError: null,
    sendAfter: n.sendAfter,
  });
}

/**
 * Write a terminal status, but only over a row that is still ours to write. The
 * status predicate stops a late finalize from overwriting a result that landed
 * meanwhile — a delivery webhook advancing SENT to DELIVERED/READ, or a
 * cancellation — with stale state.
 *
 * The send paths restore `sendAfter` so the claim lease leaves no trace: the
 * sweep measures its FAILED grace period from the row's original due time, not
 * from whenever the last attempt happened to run.
 *
 * Retried in-process because of what a lost write costs after a successful send:
 * the row would stay QUEUED and eventually be sent again. A connection blip or a
 * Neon compute waking up is over in seconds, well inside this budget.
 */
async function finalize(
  id: string,
  data: {
    status: "SENT" | "FAILED" | "CANCELLED";
    providerMsgId?: string | null;
    phoneNumberId?: string | null;
    lastError?: string | null;
    sendAfter?: Date;
  },
): Promise<void> {
  const backoffMs = [500, 1_500, 4_500];
  for (let i = 0; ; i++) {
    try {
      await prisma.notification.updateMany({
        where: { id, status: { in: SENDABLE } },
        data,
      });
      return;
    } catch (e) {
      if (i >= backoffMs.length) throw e;
      await new Promise((resolve) => setTimeout(resolve, backoffMs[i]));
    }
  }
}

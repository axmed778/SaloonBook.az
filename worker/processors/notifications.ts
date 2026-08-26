import type { Job } from "bullmq";
import { prisma } from "../../src/lib/prisma";
import { sendWhatsAppTemplate } from "../../src/lib/whatsapp";
import { resolveWhatsAppSender } from "../../src/lib/whatsapp-sender";
import { buildComponents } from "../../src/lib/whatsapp-templates";
import type { NotificationJob } from "../../src/lib/queue";

const DONE = new Set(["SENT", "DELIVERED", "READ"]);

export async function processNotification(job: Job<NotificationJob>): Promise<void> {
  const { notificationId } = job.data;

  const n = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: {
      appointment: {
        select: { status: true, endsAt: true, manageToken: true, salon: { select: { slug: true } } },
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
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "CANCELLED" },
    });
    return;
  }

  // Nor may it fire for an appointment that is already over. This matters now
  // that the sweep revives FAILED rows: a provider outage long enough to exhaust
  // the retries can be followed, hours later, by a batch of "your appointment is
  // tomorrow at 15:00" reminders for visits that already happened. Cancellation
  // notices are exempt for the same reason as above — they exist precisely
  // because the appointment isn't happening.
  if (!isCancellationNotice && n.appointment && n.appointment.endsAt <= new Date()) {
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "CANCELLED", lastError: "appointment already ended" },
    });
    return;
  }

  try {
    // Resolve which number this salon sends from: its own (PRO + ACTIVE own-number
    // sender) or the shared platform number. Never throws — falls back to platform.
    const sender = await resolveWhatsAppSender(n.salonId);

    const res = await sendWhatsAppTemplate({
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

    await prisma.notification.update({
      where: { id: n.id },
      data: {
        status: "SENT",
        providerMsgId: res.providerMsgId ?? null,
        // Stamp the sending number so inbound status webhooks can be scoped to
        // the owning salon (null in sandbox/platform-unset — the wamid still
        // uniquely identifies the row).
        phoneNumberId: sender.phoneNumberId ?? null,
        attempts: { increment: 1 },
        lastError: null,
      },
    });
  } catch (e) {
    await prisma.notification.update({
      where: { id: n.id },
      data: {
        status: "FAILED",
        attempts: { increment: 1 },
        lastError: e instanceof Error ? e.message : String(e),
      },
    });
    throw e; // let BullMQ retry with backoff
  }
}

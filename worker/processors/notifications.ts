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
        select: { status: true, manageToken: true, salon: { select: { slug: true } } },
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

import type { Job } from "bullmq";
import { prisma } from "../../src/lib/prisma";
import { sendWhatsAppTemplate } from "../../src/lib/whatsapp";
import { resolveWhatsAppSender } from "../../src/lib/whatsapp-sender";
import { buildComponents } from "../../src/lib/whatsapp-templates";
import { limitsFor } from "../../src/lib/plans";
import { effectivePlan, subscriptionForSalon } from "../../src/lib/subscription";
import { bakuPeriodYm } from "../../src/lib/time";
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

  // --- Plan reminder-quota enforcement (appointment_reminder only) ---
  // The WhatsApp reminder quota (plan's maxRemindersPerMonth) is the one paid
  // limit measured in messages, not bookings. Only the T-24h reminder is gated —
  // confirmations, cancellations and owner alerts are never counted, so a salon
  // over quota still gets its transactional messages. FAIL-OPEN: any error in the
  // check sends the reminder rather than dropping the product's core value.
  const periodYm = bakuPeriodYm(new Date());
  if (n.template === "appointment_reminder") {
    try {
      const sub = await subscriptionForSalon(prisma, n.salonId);
      const max = limitsFor(effectivePlan(sub)).maxRemindersPerMonth;
      if (Number.isFinite(max)) {
        const counter = await prisma.usageCounter.findUnique({
          where: { salonId_periodYm: { salonId: n.salonId, periodYm } },
          select: { reminders: true },
        });
        if ((counter?.reminders ?? 0) >= max) {
          // Terminal status so the QUEUED sweep never re-enqueues it; the
          // lastError marker distinguishes a quota skip from a real cancellation.
          await prisma.notification.update({
            where: { id: n.id },
            data: { status: "CANCELLED", lastError: "reminder_quota_exceeded" },
          });
          console.log(
            `[worker] reminder skipped: salon ${n.salonId} over monthly quota (${max})`,
          );
          return;
        }
      }
    } catch (e) {
      console.error("[worker] reminder quota check failed, sending anyway", e);
    }
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

    // Count only reminders that actually went out. Idempotent across retries: a
    // failed send throws before reaching here, so it never double-counts. Best-
    // effort — a counter write must not fail an already-sent message.
    if (n.template === "appointment_reminder") {
      await prisma.usageCounter
        .upsert({
          where: { salonId_periodYm: { salonId: n.salonId, periodYm } },
          create: { salonId: n.salonId, periodYm, reminders: 1 },
          update: { reminders: { increment: 1 } },
        })
        .catch((e) => console.error("[worker] reminder quota increment failed", e));
    }
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

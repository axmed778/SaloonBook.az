import type { Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { sendWhatsAppTemplate } from "../../src/lib/whatsapp";
import { formatBakuDateTime } from "../../src/lib/time";
import type { NotificationJob } from "../../src/lib/queue";

const DONE = new Set(["SENT", "DELIVERED", "READ"]);

/**
 * Map a persisted Notification payload to Meta template body variables. The
 * ORDER here MUST match the {{1}}, {{2}}, {{3}} placeholders in the approved
 * template of the same name (see the templates to submit in the WhatsApp setup
 * notes). Returns undefined for templates with no variables.
 */
function buildComponents(template: string, payload: Prisma.JsonValue): unknown {
  const p = (payload ?? {}) as Record<string, unknown>;
  const when = typeof p.startsAt === "string" ? formatBakuDateTime(new Date(p.startsAt)) : "";

  let params: string[];
  switch (template) {
    // To customer — {{1}} salon, {{2}} service, {{3}} when
    case "booking_confirmation":
    case "appointment_reminder":
      params = [String(p.salon ?? ""), String(p.service ?? ""), when];
      break;
    // To owner — {{1}} customer, {{2}} service, {{3}} when
    case "new_booking_alert":
      params = [String(p.customer ?? ""), String(p.service ?? ""), when];
      break;
    default:
      params = [];
  }

  if (params.length === 0) return undefined;
  return [
    {
      type: "body",
      parameters: params.map((text) => ({ type: "text", text })),
    },
  ];
}

export async function processNotification(job: Job<NotificationJob>): Promise<void> {
  const { notificationId } = job.data;

  const n = await prisma.notification.findUnique({
    where: { id: notificationId },
    include: { appointment: { select: { status: true } } },
  });
  if (!n) return;
  if (DONE.has(n.status)) return; // idempotent: already sent
  if (n.status === "CANCELLED") return; // cancelled while queued (e.g. by setAppointmentStatus)

  // Re-check the appointment at send time: a reminder queued at booking time
  // must never fire for an appointment that was since cancelled or no-showed.
  // (Delayed BullMQ jobs can't be reliably removed, so the guard lives here.)
  const apptStatus = n.appointment?.status;
  if (apptStatus === "CANCELLED" || apptStatus === "NO_SHOW") {
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: "CANCELLED" },
    });
    return;
  }

  try {
    const res = await sendWhatsAppTemplate({
      toPhone: n.toPhone,
      template: n.template,
      languageCode: "az",
      components: buildComponents(n.template, n.payload),
    });

    await prisma.notification.update({
      where: { id: n.id },
      data: {
        status: "SENT",
        providerMsgId: res.providerMsgId ?? null,
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

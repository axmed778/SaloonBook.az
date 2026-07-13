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
 * template of the same name (see docs/whatsapp-templates.md — the templates
 * must be created on Meta exactly as documented there, including the URL
 * buttons, or sends will fail with a component mismatch). Returns undefined
 * for templates with no variables.
 */
function buildComponents(
  template: string,
  payload: Prisma.JsonValue,
  appt: { manageToken: string; salonSlug: string } | null,
): unknown {
  const p = (payload ?? {}) as Record<string, unknown>;
  const when = typeof p.startsAt === "string" ? formatBakuDateTime(new Date(p.startsAt)) : "";

  let params: string[];
  switch (template) {
    // To customer — {{1}} salon, {{2}} service, {{3}} when
    case "booking_confirmation":
    case "appointment_reminder":
    case "appointment_cancelled": // salon cancelled the customer's appointment
      params = [String(p.salon ?? ""), String(p.service ?? ""), when];
      break;
    // To owner — {{1}} customer, {{2}} service, {{3}} when
    case "new_booking_alert":
    case "booking_cancelled_alert": // customer cancelled via the manage link
    case "appointment_rescheduled_alert": // customer moved the appointment via the manage link
      params = [String(p.customer ?? ""), String(p.service ?? ""), when];
      break;
    default:
      params = [];
  }

  const components: unknown[] = [];
  if (params.length > 0) {
    components.push({
      type: "body",
      parameters: params.map((text) => ({ type: "text", text })),
    });
  }

  // Customer-facing templates carry a dynamic URL button (part of the approved
  // template; the code only supplies the URL suffix): confirmation and reminder
  // deep-link to the self-service manage page (/a/{token}) so the customer can
  // cancel or reschedule; the cancellation notice links back to the salon's
  // booking page (/{slug}) so they can rebook.
  if (appt) {
    if (template === "booking_confirmation" || template === "appointment_reminder") {
      components.push(urlButton(appt.manageToken));
    } else if (template === "appointment_cancelled") {
      components.push(urlButton(appt.salonSlug));
    }
  }

  return components.length > 0 ? components : undefined;
}

// Meta's shape for filling a template's dynamic-URL button: the text becomes
// the {{1}} suffix of the button URL defined on the template.
function urlButton(urlSuffix: string): unknown {
  return {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: urlSuffix }],
  };
}

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
    const res = await sendWhatsAppTemplate({
      toPhone: n.toPhone,
      template: n.template,
      languageCode: "az",
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

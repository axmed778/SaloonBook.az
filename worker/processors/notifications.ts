import type { Job } from "bullmq";
import { prisma } from "../../src/lib/prisma";
import { sendWhatsAppTemplate } from "../../src/lib/whatsapp";
import type { NotificationJob } from "../../src/lib/queue";

const DONE = new Set(["SENT", "DELIVERED", "READ"]);

export async function processNotification(job: Job<NotificationJob>): Promise<void> {
  const { notificationId } = job.data;

  const n = await prisma.notification.findUnique({ where: { id: notificationId } });
  if (!n) return;
  if (DONE.has(n.status)) return; // idempotent: already sent

  try {
    const res = await sendWhatsAppTemplate({
      toPhone: n.toPhone,
      template: n.template,
      // NOTE: real template `components` are built from n.payload once the
      // matching template is approved by Meta. Sandbox mode logs the payload.
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

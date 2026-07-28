import type { Job } from "bullmq";
import { prisma } from "../../src/lib/prisma";
import { sendWebPush } from "../../src/lib/push";
import { formatBakuDateTime } from "../../src/lib/time";
import type { PushJob } from "../../src/lib/queue";

const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

// Send a Web Push event to every device subscribed for the appointment's salon.
// The message is built here (not at enqueue time) so a cancel/reschedule between
// enqueue and send is reflected. Owner-facing copy is Azerbaijani.
export async function processPush(job: Job<PushJob>): Promise<void> {
  const { type, appointmentId } = job.data;

  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    select: {
      salonId: true,
      status: true,
      startsAt: true,
      attendeeName: true,
      service: { select: { name: true } },
      customer: { select: { name: true } },
    },
  });
  if (!appt) return;

  // The T-2h reminder is scheduled at booking time. Only fire it if the
  // appointment is still CONFIRMED and genuinely near now — this drops reminders
  // for appointments cancelled or rescheduled far away after the job was queued.
  if (type === "reminder") {
    const msUntil = appt.startsAt.getTime() - Date.now();
    if (appt.status !== "CONFIRMED" || msUntil <= 0 || msUntil > 3 * 60 * 60_000) return;
  }

  const who = appt.attendeeName ?? appt.customer.name;
  const when = formatBakuDateTime(appt.startsAt);
  const detail = `${who} · ${appt.service.name} · ${when}`;

  let title: string;
  switch (type) {
    case "new_booking":
      title = "Yeni rezervasiya";
      break;
    case "booking_cancelled":
      title = "Rezervasiya ləğv edildi";
      break;
    case "reminder":
      title = "Yaxınlaşan görüş";
      break;
  }

  const subs = await prisma.pushSubscription.findMany({
    where: { salonId: appt.salonId },
    select: { endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return;

  const message = {
    title,
    body: detail,
    url: `${APP_URL}/dashboard`,
    tag: `${type}:${appointmentId}`,
  };

  // Send in parallel; collect endpoints the push service reported as gone.
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      const res = await sendWebPush(
        { endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth },
        message,
      );
      if (!res.ok && res.gone) dead.push(s.endpoint);
    }),
  );

  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
    console.log(`[push] pruned ${dead.length} dead subscription(s)`);
  }
}

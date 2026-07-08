import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getAvailableSlots, isSlotBookable, type SlotRejectReason } from "@/lib/availability";
import { isOverlapError } from "@/lib/booking";
import { enqueueNotification } from "@/lib/queue";
import { rateLimit, clientIp } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

// Self-service appointment management. The manageToken in the URL is the whole
// capability: whoever holds the link (shown after booking; later a WhatsApp
// button) can view, cancel or reschedule that one appointment. Unauthenticated
// by design — customers have no accounts.

const TOKEN_RE = /^[0-9a-f-]{36}$/i;
const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

// How far ahead a reschedule may land (same horizon as the booking widget +
// slack) — bounds abuse and typos.
const MAX_AHEAD_DAYS = 60;

const SLOT_REASON_AZ: Record<SlotRejectReason, string> = {
  service: "Xidmət tapılmadı.",
  past: "Bu vaxt keçmişdə qalıb.",
  hours: "İşçi bu vaxt işləmir.",
  timeoff: "İşçi bu vaxt məzuniyyətdədir.",
  overlap: "Bu vaxt artıq tutulub.",
};

async function loadByToken(token: string) {
  if (!TOKEN_RE.test(token)) return null;
  return prisma.appointment.findUnique({
    where: { manageToken: token },
    select: {
      id: true,
      salonId: true,
      employeeId: true,
      serviceId: true,
      status: true,
      startsAt: true,
      salon: { select: { name: true, phone: true, status: true } },
      service: { select: { name: true } },
      customer: { select: { name: true, phone: true } },
    },
  });
}

// --- GET: free slots for a day (reschedule picker) ---------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const rl = await rateLimit(`manage:get:${clientIp(req)}`, 60, 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Çox sayda sorğu." },
      { status: 429, headers: { "Retry-After": String(rl.resetSec) } },
    );
  }

  const date = req.nextUrl.searchParams.get("date") ?? "";
  if (!YMD_RE.test(date)) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  const appt = await loadByToken(token);
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const slots = await getAvailableSlots({
    employeeId: appt.employeeId,
    serviceId: appt.serviceId,
    dayYmd: date,
    // The appointment's own interval must not block its own reschedule.
    excludeAppointmentId: appt.id,
  });
  return NextResponse.json({ date, slots });
}

// --- POST: cancel or reschedule ----------------------------------------------

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel") }),
  z.object({ action: z.literal("reschedule"), startUtc: z.string().datetime() }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const ip = clientIp(req);
  const [ipRl, tokenRl] = await Promise.all([
    rateLimit(`manage:post:ip:${ip}`, 10, 60),
    rateLimit(`manage:post:token:${token}`, 10, 3600),
  ]);
  if (!ipRl.allowed || !tokenRl.allowed) {
    const resetSec = Math.max(ipRl.resetSec, tokenRl.resetSec);
    return NextResponse.json(
      { error: "Çox sayda cəhd. Bir az sonra yenidən yoxlayın." },
      { status: 429, headers: { "Retry-After": String(resetSec) } },
    );
  }

  const json = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const appt = await loadByToken(token);
  if (!appt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const now = new Date();
  if (appt.status !== "CONFIRMED") {
    return NextResponse.json(
      { error: "Bu görüş artıq aktiv deyil." },
      { status: 409 },
    );
  }
  if (appt.startsAt <= now) {
    return NextResponse.json(
      { error: "Vaxtı keçmiş görüş dəyişdirilə bilməz." },
      { status: 409 },
    );
  }

  if (parsed.data.action === "cancel") {
    const ownerNoticeId = await prisma.$transaction(async (tx) => {
      // Status guard inside the filter = idempotency under races.
      const res = await tx.appointment.updateMany({
        where: { id: appt.id, status: "CONFIRMED" },
        data: { status: "CANCELLED" },
      });
      if (res.count === 0) throw new Error("conflict");

      // The reminder (and anything else still queued) must not fire.
      await tx.notification.updateMany({
        where: { appointmentId: appt.id, status: "QUEUED" },
        data: { status: "CANCELLED" },
      });

      // Tell the salon the customer cancelled.
      if (!appt.salon.phone) return null;
      const notice = await tx.notification.create({
        data: {
          salonId: appt.salonId,
          appointmentId: appt.id,
          template: "booking_cancelled_alert",
          toPhone: appt.salon.phone,
          payload: {
            customer: appt.customer.name,
            service: appt.service.name,
            startsAt: appt.startsAt.toISOString(),
          },
        },
        select: { id: true },
      });
      return notice.id;
    }).catch((e) => {
      if (e instanceof Error && e.message === "conflict") return "conflict" as const;
      throw e;
    });

    if (ownerNoticeId === "conflict") {
      return NextResponse.json({ error: "Bu görüş artıq aktiv deyil." }, { status: 409 });
    }
    if (ownerNoticeId) {
      await enqueueBestEffort([{ id: ownerNoticeId }]);
    }
    return NextResponse.json({ ok: true });
  }

  // --- Reschedule ---
  // A reschedule is effectively a new booking, so it must honor the salon's
  // status the same way the public /book route does. A SUSPENDED (or otherwise
  // non-active) salon takes no new commitments; cancelling above stays allowed.
  if (appt.salon.status !== "ACTIVE") {
    return NextResponse.json(
      { error: "Salon hazırda əlçatan deyil. Görüşü yalnız ləğv edə bilərsiniz." },
      { status: 409 },
    );
  }

  const startUtc = new Date(parsed.data.startUtc);
  if (startUtc.getTime() > now.getTime() + MAX_AHEAD_DAYS * 86_400_000) {
    return NextResponse.json({ error: "Bu tarix çox uzaqdır." }, { status: 400 });
  }

  const check = await isSlotBookable(prisma, {
    employeeId: appt.employeeId,
    serviceId: appt.serviceId,
    startUtc,
    excludeAppointmentId: appt.id,
  });
  if (!check.ok) {
    return NextResponse.json(
      { error: SLOT_REASON_AZ[check.reason] ?? "Bu vaxt uyğun deyil." },
      { status: 409 },
    );
  }

  let toEnqueue: Array<{ id: string; delayMs?: number }>;
  try {
    toEnqueue = await prisma.$transaction(async (tx) => {
      const res = await tx.appointment.updateMany({
        where: { id: appt.id, status: "CONFIRMED" },
        data: { startsAt: startUtc, endsAt: check.endUtc },
      });
      if (res.count === 0) throw new Error("conflict");

      // Old reminder carries the old time — kill anything still queued.
      await tx.notification.updateMany({
        where: { appointmentId: appt.id, status: "QUEUED" },
        data: { status: "CANCELLED" },
      });

      // Fresh confirmation (new time) + fresh T-24h reminder.
      const payload = {
        salon: appt.salon.name,
        service: appt.service.name,
        startsAt: startUtc.toISOString(),
      };
      const confirmation = await tx.notification.create({
        data: {
          salonId: appt.salonId,
          appointmentId: appt.id,
          template: "booking_confirmation",
          toPhone: appt.customer.phone,
          payload,
        },
        select: { id: true },
      });
      const toEnqueue: Array<{ id: string; delayMs?: number }> = [{ id: confirmation.id }];
      // Skip a reminder that would already be due (new time <24h out): it would
      // leave a QUEUED row that never enqueues and lingers forever.
      const reminderAt = new Date(startUtc.getTime() - 24 * 60 * 60_000);
      if (reminderAt > new Date()) {
        const reminder = await tx.notification.create({
          data: {
            salonId: appt.salonId,
            appointmentId: appt.id,
            template: "appointment_reminder",
            toPhone: appt.customer.phone,
            sendAfter: reminderAt,
            payload,
          },
          select: { id: true },
        });
        toEnqueue.push({ id: reminder.id, delayMs: reminderAt.getTime() - Date.now() });
      }
      return toEnqueue;
    });
  } catch (e) {
    if (e instanceof Error && e.message === "conflict") {
      return NextResponse.json({ error: "Bu görüş artıq aktiv deyil." }, { status: 409 });
    }
    if (isOverlapError(e)) {
      return NextResponse.json({ error: "Bu vaxt artıq tutulub." }, { status: 409 });
    }
    console.error("[manage] reschedule error", e);
    return NextResponse.json({ error: "Dəyişiklik alınmadı." }, { status: 500 });
  }

  await enqueueBestEffort(toEnqueue);
  return NextResponse.json({ ok: true, startUtc: startUtc.toISOString() });
}

/**
 * Push to the queue, best-effort and time-bounded (same policy as booking):
 * the DB change already committed, so a slow/unreachable Redis must neither
 * fail nor delay the response — rows stay QUEUED and can be swept later.
 */
async function enqueueBestEffort(items: Array<{ id: string; delayMs?: number }>): Promise<void> {
  try {
    await Promise.race([
      (async () => {
        for (const it of items) {
          if (it.delayMs !== undefined && it.delayMs <= 0) continue;
          await enqueueNotification(it.id, it.delayMs);
        }
      })(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("enqueue timed out")), 2000)),
    ]);
  } catch (e) {
    console.error("[manage] enqueue failed/timed out (rows persisted QUEUED)", e);
  }
}

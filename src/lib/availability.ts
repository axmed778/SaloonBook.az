import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import {
  bakuWallClockToUtc,
  bakuWeekday,
  bakuDayBoundsUtc,
  bakuYmd,
  bakuMinutesOfDay,
  minutesToHHMM,
} from "./time";

/** A Prisma client or an interactive-transaction client. */
type Db = typeof prisma | Prisma.TransactionClient;

export interface Slot {
  /** UTC instant of the slot start, ISO string. */
  startUtc: string;
  /** Baku local label, "HH:MM". */
  time: string;
}

export interface AvailabilityQuery {
  employeeId: string;
  serviceId: string;
  /** Baku calendar day, "YYYY-MM-DD". */
  dayYmd: string;
  /** Slot granularity in minutes. */
  stepMin?: number;
  /**
   * Ignore this appointment's own interval (reschedule flows: the slot being
   * moved must not block itself, and its current time should read as free).
   */
  excludeAppointmentId?: string;
}

interface Interval {
  start: number; // epoch ms (UTC)
  end: number;
}

function overlaps(aStart: number, aEnd: number, b: Interval): boolean {
  return aStart < b.end && aEnd > b.start;
}

/**
 * The single source of truth for "is [start, end) a valid slot?", shared by the
 * read path (getAvailableSlots) and the write path (isSlotBookable): the slot
 * must be in the future, fit entirely inside one working window, and not collide
 * with any busy interval (time-off or confirmed appointment).
 */
function slotPasses(opts: {
  startMs: number;
  endMs: number;
  startMin: number;
  endMin: number;
  windows: Array<{ startMin: number; endMin: number }>;
  busy: Interval[];
  now: number;
}): boolean {
  if (opts.startMs <= opts.now) return false;
  const fitsWindow = opts.windows.some(
    (w) => opts.startMin >= w.startMin && opts.endMin <= w.endMin,
  );
  if (!fitsWindow) return false;
  if (opts.busy.some((b) => overlaps(opts.startMs, opts.endMs, b))) return false;
  return true;
}

export type SlotRejectReason = "service" | "past" | "hours" | "timeoff" | "overlap";

export type SlotBookable =
  | { ok: true; endUtc: Date }
  | { ok: false; reason: SlotRejectReason };

/**
 * Authoritative server-side check that a specific requested startUtc is bookable
 * for (employee, service). Use the SAME rules the availability read path shows,
 * so calling /book directly cannot smuggle in a past / out-of-hours / time-off
 * slot. Pass a transaction client (`tx`) to make the check part of the booking
 * transaction. The DB exclusion constraint remains the final guarantee against
 * concurrent overlaps; the "overlap" reason here just yields a cleaner error.
 */
export async function isSlotBookable(
  db: Db,
  args: {
    employeeId: string;
    serviceId: string;
    startUtc: Date;
    now?: number;
    /** See AvailabilityQuery.excludeAppointmentId (reschedule flows). */
    excludeAppointmentId?: string;
  },
): Promise<SlotBookable> {
  const now = args.now ?? Date.now();

  const service = await db.service.findFirst({
    where: { id: args.serviceId, isActive: true },
    select: { durationMin: true, bufferMin: true },
  });
  if (!service) return { ok: false, reason: "service" };

  const blockMin = service.durationMin + service.bufferMin;
  const startMs = args.startUtc.getTime();
  const endMs = startMs + blockMin * 60_000;
  const endUtc = new Date(endMs);

  const ymd = bakuYmd(args.startUtc);
  const weekday = bakuWeekday(ymd);
  const startMin = bakuMinutesOfDay(args.startUtc);
  const endMin = startMin + blockMin;

  const [windows, timeOff, appts] = await Promise.all([
    db.workingHour.findMany({
      where: { employeeId: args.employeeId, weekday },
      select: { startMin: true, endMin: true },
    }),
    db.timeOff.findMany({
      where: { employeeId: args.employeeId, startsAt: { lt: endUtc }, endsAt: { gt: args.startUtc } },
      select: { startsAt: true, endsAt: true },
    }),
    db.appointment.findMany({
      where: {
        employeeId: args.employeeId,
        status: "CONFIRMED",
        startsAt: { lt: endUtc },
        endsAt: { gt: args.startUtc },
        ...(args.excludeAppointmentId ? { id: { not: args.excludeAppointmentId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  // Distinguish reasons for a clean caller-facing error.
  if (startMs <= now) return { ok: false, reason: "past" };
  const fitsWindow = windows.some((w) => startMin >= w.startMin && endMin <= w.endMin);
  if (!fitsWindow) return { ok: false, reason: "hours" };
  if (timeOff.length > 0) return { ok: false, reason: "timeoff" };
  if (appts.length > 0) return { ok: false, reason: "overlap" };

  return { ok: true, endUtc };
}

/**
 * Computes bookable start times for (employee, service, day).
 *
 * A slot is valid when [start, start + duration + buffer) fits entirely inside
 * one of the employee's working windows for that weekday, does not overlap any
 * time-off or existing CONFIRMED appointment, and is not in the past.
 *
 * This is the read side. The write side (createBooking) re-checks atomically and
 * the DB exclusion constraint is the final guarantee — so a slot shown here that
 * gets taken in the meantime fails cleanly at booking time.
 */
export async function getAvailableSlots(q: AvailabilityQuery): Promise<Slot[]> {
  const stepMin = q.stepMin ?? 15;

  const service = await prisma.service.findUnique({
    where: { id: q.serviceId },
    select: { durationMin: true, bufferMin: true, isActive: true },
  });
  if (!service || !service.isActive) return [];

  const blockMin = service.durationMin + service.bufferMin;
  const weekday = bakuWeekday(q.dayYmd);

  const workingHours = await prisma.workingHour.findMany({
    where: { employeeId: q.employeeId, weekday },
    select: { startMin: true, endMin: true },
    orderBy: { startMin: "asc" },
  });
  if (workingHours.length === 0) return [];

  const { startUtc, endUtc } = bakuDayBoundsUtc(q.dayYmd);

  const [timeOff, appts] = await Promise.all([
    prisma.timeOff.findMany({
      where: { employeeId: q.employeeId, startsAt: { lt: endUtc }, endsAt: { gt: startUtc } },
      select: { startsAt: true, endsAt: true },
    }),
    prisma.appointment.findMany({
      where: {
        employeeId: q.employeeId,
        status: "CONFIRMED",
        startsAt: { lt: endUtc },
        endsAt: { gt: startUtc },
        ...(q.excludeAppointmentId ? { id: { not: q.excludeAppointmentId } } : {}),
      },
      select: { startsAt: true, endsAt: true },
    }),
  ]);

  const busy: Interval[] = [
    ...timeOff.map((t) => ({ start: t.startsAt.getTime(), end: t.endsAt.getTime() })),
    ...appts.map((a) => ({ start: a.startsAt.getTime(), end: a.endsAt.getTime() })),
  ];

  const now = Date.now();
  const slots: Slot[] = [];

  for (const w of workingHours) {
    for (let m = w.startMin; m + blockMin <= w.endMin; m += stepMin) {
      const slotStart = bakuWallClockToUtc(q.dayYmd, m);
      const startMs = slotStart.getTime();
      const endMs = startMs + blockMin * 60_000;

      const ok = slotPasses({
        startMs,
        endMs,
        startMin: m,
        endMin: m + blockMin,
        windows: workingHours,
        busy,
        now,
      });
      if (!ok) continue;

      slots.push({ startUtc: slotStart.toISOString(), time: minutesToHHMM(m) });
    }
  }

  return slots;
}

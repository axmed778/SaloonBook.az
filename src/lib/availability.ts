import { prisma } from "./prisma";
import {
  bakuWallClockToUtc,
  bakuWeekday,
  bakuDayBoundsUtc,
  minutesToHHMM,
} from "./time";

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
}

interface Interval {
  start: number; // epoch ms (UTC)
  end: number;
}

function overlaps(aStart: number, aEnd: number, b: Interval): boolean {
  return aStart < b.end && aEnd > b.start;
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

      if (startMs <= now) continue;
      if (busy.some((b) => overlaps(startMs, endMs, b))) continue;

      slots.push({ startUtc: slotStart.toISOString(), time: minutesToHHMM(m) });
    }
  }

  return slots;
}

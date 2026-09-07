// Shared, framework-neutral shape for the "Bu gün" list. Split out of
// today-view.tsx ("use client") so the server page — and a unit test — can build
// a row without pulling in a client module.

import { bakuMinutesOfDay, minutesToHHMM } from "@/lib/time";
import type { SerializedBooking } from "@/lib/serializers/booking";
import { azn } from "./calendar-shared";

export type TodayApptStatus = "CONFIRMED" | "COMPLETED" | "NO_SHOW";

export interface TodayAppointment {
  id: string;
  time: string; // Baku "HH:MM"
  status: TodayApptStatus;
  overdue: boolean; // CONFIRMED and end time already passed
  service: string;
  employee: string;
  clientName: string;
  /**
   * E.164. OWNER/ADMIN only — for a master's login the key is ABSENT (the phone
   * is neither selected nor serialized, so it is not in the RSC payload this
   * list is streamed through). The row shows its WhatsApp button only when the
   * number is actually here.
   */
  clientPhone?: string;
  priceLabel: string; // "25 ₼"
}

/**
 * Serialized booking -> today row. The single builder for this list, so the
 * contact field is carried across exactly once.
 */
export function toTodayAppointment(
  b: SerializedBooking,
  now = Date.now(),
): TodayAppointment {
  return {
    id: b.id,
    time: minutesToHHMM(bakuMinutesOfDay(b.startsAt)),
    status: b.status as TodayApptStatus,
    // A past-but-still-CONFIRMED booking needs closing (complete / no-show).
    overdue: b.status === "CONFIRMED" && b.endsAt.getTime() < now,
    service: b.serviceName,
    employee: b.employeeName,
    clientName: b.customerName,
    priceLabel: `${azn(b.priceMinor)} ₼`,
    // Conditional spread: assigning `undefined` would still create the key.
    ...(b.customerPhone !== undefined ? { clientPhone: b.customerPhone } : {}),
  };
}

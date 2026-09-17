// Shared, framework-neutral shape for the "Bu gün" list. Split out of
// today-view.tsx ("use client") so the server page — and a unit test — can build
// a row without pulling in a client module.

import { bakuMinutesOfDay, minutesToHHMM } from "@/lib/time";
import { serviceWithAddons } from "@/lib/addons";
import type { SerializedBooking } from "@/lib/serializers/booking";
import {
  netReceivedMinor,
  tipsMinor as sumTips,
  type PaymentEntry,
  type PaymentStatus,
} from "@/lib/finance/payments";
import { azn } from "./calendar-shared";

export type TodayApptStatus = "CONFIRMED" | "COMPLETED" | "NO_SHOW";

export interface TodayAppointment {
  id: string;
  time: string; // Baku "HH:MM"
  status: TodayApptStatus;
  overdue: boolean; // CONFIRMED and end time already passed
  service: string; // service + booked add-ons, one line
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
  /**
   * Paid / partial / unpaid. OWNER/ADMIN/FINANCE only — for a master's login the
   * key is ABSENT, like clientPhone, so the row has no badge to render and the
   * payload carries no money. Requires payments.read.
   */
  paymentStatus?: PaymentStatus;
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
    service: serviceWithAddons(b.serviceName, b.addonNames),
    employee: b.employeeName,
    clientName: b.customerName,
    priceLabel: `${azn(b.priceMinor)} ₼`,
    // Conditional spread: assigning `undefined` would still create the key.
    ...(b.customerPhone !== undefined ? { clientPhone: b.customerPhone } : {}),
    ...(b.payments !== undefined ? { paymentStatus: b.payments.status } : {}),
  };
}

/**
 * Today's takings, split by method.
 *
 * Every figure comes from the rule functions in lib/finance/payments — this does
 * NOT re-derive that a REFUND subtracts, and does not trust the caller to have
 * filtered voided rows out of the query. Phase 3's shift close reads the same
 * function against the same rows, and two places signing money independently is
 * how a close comes to disagree with the strip above it.
 *
 * Tips are kept OUT of the per-method figures and reported on their own: a tip
 * is not revenue and not part of any payout base (D6), so folding it into "cash"
 * would overstate what the salon earned. It is still money in the drawer, which
 * is why it is counted at all — the shift close adds it to expected cash, and
 * having it here already means that screen inherits a number that balances.
 */
export interface DayTotals {
  byMethod: { method: PaymentMethodKey; netMinor: number }[];
  netMinor: number;
  tipsMinor: number;
}

export type PaymentMethodKey = "CASH" | "CARD" | "TERMINAL" | "TRANSFER";

/** A day's payment row: a rule-function entry plus the method it came in by. */
export interface DayPaymentRow extends PaymentEntry {
  method: PaymentMethodKey;
}

const METHOD_ORDER: PaymentMethodKey[] = ["CASH", "CARD", "TERMINAL", "TRANSFER"];

export function dayTotalsByMethod(rows: readonly DayPaymentRow[]): DayTotals {
  // Fixed order, and a method nobody used today is simply absent rather than a
  // row of zeros — the strip is read at a glance on a phone. netReceivedMinor
  // drops the voided rows itself, so a caller that hands over everything and a
  // caller that pre-filters get the same answer.
  const byMethod = METHOD_ORDER.map((method) => ({
    method,
    netMinor: netReceivedMinor(rows.filter((r) => r.method === method)),
  })).filter((m) => m.netMinor !== 0);
  return {
    byMethod,
    netMinor: netReceivedMinor(rows),
    tipsMinor: sumTips(rows),
  };
}

// Shared, framework-neutral shape for the "Bu gün" list. Split out of
// today-view.tsx ("use client") so the server page — and a unit test — can build
// a row without pulling in a client module.

import { bakuMinutesOfDay, minutesToHHMM } from "@/lib/time";
import { serviceWithAddons } from "@/lib/addons";
import type { SerializedBooking } from "@/lib/serializers/booking";
import type { PaymentStatus } from "@/lib/finance/payments";
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
 * Today's takings, split by method. Payments minus refunds, voided rows already
 * excluded by the caller's query.
 *
 * Tips are kept OUT of the per-method figures and reported on their own: a tip
 * is not revenue and not part of any payout base (D6), so folding it into "cash"
 * would overstate what the salon earned. It is still money in the drawer, which
 * is why it is counted at all — the shift close in phase 3 adds it to expected
 * cash, and having it here already means that screen inherits a number that
 * already balances.
 */
export interface DayTotals {
  byMethod: { method: PaymentMethodKey; netMinor: number }[];
  netMinor: number;
  tipsMinor: number;
}

export type PaymentMethodKey = "CASH" | "CARD" | "TERMINAL" | "TRANSFER";

const METHOD_ORDER: PaymentMethodKey[] = ["CASH", "CARD", "TERMINAL", "TRANSFER"];

export function dayTotalsByMethod(
  rows: readonly {
    kind: "PAYMENT" | "REFUND";
    method: PaymentMethodKey;
    amountMinor: number;
    tipMinor: number;
  }[],
): DayTotals {
  const net = new Map<PaymentMethodKey, number>();
  let tipsMinor = 0;
  for (const r of rows) {
    const signed = r.kind === "REFUND" ? -r.amountMinor : r.amountMinor;
    net.set(r.method, (net.get(r.method) ?? 0) + signed);
    tipsMinor += r.tipMinor;
  }
  // Fixed order, and a method nobody used today is simply absent rather than a
  // row of zeros — the strip is read at a glance on a phone.
  const byMethod = METHOD_ORDER.filter((m) => (net.get(m) ?? 0) !== 0).map((method) => ({
    method,
    netMinor: net.get(method) ?? 0,
  }));
  return {
    byMethod,
    netMinor: [...net.values()].reduce((a, b) => a + b, 0),
    tipsMinor,
  };
}

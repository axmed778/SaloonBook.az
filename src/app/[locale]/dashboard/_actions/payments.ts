"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { bakuYmd } from "@/lib/time";
import {
  refuseNewPayment,
  refuseRefund,
  type PaymentEntry,
  type PaymentRefusal,
} from "@/lib/finance/payments";

// Taking money on a booking, handing it back, and undoing an entry.
//
// Every one of these is a POST endpoint of its own, so each opens with
// requirePermission("payments.write") as its first statement — OWNER and
// reception. FINANCE reads the same screens and holds payments.read only, so its
// buttons are not rendered AND its posts are refused here; the second half is
// the one that matters.
//
// Three rules are deliberately NOT in this file:
//   * what the entries add up to, and whether a new one fits — src/lib/finance/
//     payments.ts, pure and tested as data;
//   * what counts as revenue — src/lib/finance/revenue.ts;
//   * who may do this — src/lib/auth/permissions.ts.
// This file reads rows, asks those, and writes.
//
// A payment is never edited or deleted. A refund is a new row of kind REFUND, a
// "delete" is a void with a reason, and both leave the original in place — the
// popup shows it struck through and later exports will still carry it.

export type ActionResult = { ok: true } | { ok: false; error: string };

/** The entries a booking already has, for the rule functions. */
const ENTRY_SELECT = {
  kind: true,
  amountMinor: true,
  discountMinor: true,
  tipMinor: true,
  voidedAt: true,
} as const;

const METHODS = ["CASH", "CARD", "TERMINAL", "TRANSFER"] as const;

// Money arrives as qəpik integers — the form converts, so nothing here has to
// parse a decimal. The upper bound is a typo guard (10,000,000 ₼), not a rule.
const MAX_MINOR = 1_000_000_000;
const minor = z.number().int().min(0).max(MAX_MINOR);

const recordSchema = z.object({
  appointmentId: z.string().uuid(),
  method: z.enum(METHODS),
  amountMinor: minor,
  discountMinor: minor.default(0),
  tipMinor: minor.default(0),
  note: z.string().trim().max(500).optional(),
  /** Back-dating a payment. Absent = now. */
  paidAt: z.string().datetime().optional(),
});

const refundSchema = z.object({
  appointmentId: z.string().uuid(),
  method: z.enum(METHODS),
  amountMinor: minor,
  note: z.string().trim().max(500).optional(),
});

const voidSchema = z.object({
  paymentId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});

/** A refusal key from the rule functions becomes the caller's own language. */
async function refusalMessage(refusal: PaymentRefusal): Promise<string> {
  const t = await getTranslations("Payments.errors");
  return t(refusal);
}

/** Both calendar surfaces show payment state, so both are stale after a write. */
function revalidateBookingSurfaces(): void {
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/calendar");
}

/**
 * The booking, its live entries, and the price — or null when it is not this
 * salon's. salonId in the filter is the tenant guard; a master never reaches
 * here (no payments.write), so there is no employee narrowing to apply.
 */
async function loadBooking(salonId: string, appointmentId: string) {
  return prisma.appointment.findFirst({
    where: { id: appointmentId, salonId },
    select: { id: true, priceMinor: true, payments: { select: ENTRY_SELECT } },
  });
}

export async function recordPayment(input: unknown): Promise<ActionResult> {
  const session = await requirePermission("payments.write");
  const t = await getTranslations("Payments.errors");
  const parsed = recordSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const appt = await loadBooking(session.salonId, d.appointmentId);
  if (!appt) return { ok: false, error: t("bookingNotFound") };

  // Back-dating is allowed (the money came in yesterday and nobody recorded it)
  // but not post-dating: a payment that has not happened yet is not a payment,
  // and it would land in a shift that is not open.
  const paidAt = d.paidAt ? new Date(d.paidAt) : new Date();
  if (paidAt.getTime() > Date.now()) return { ok: false, error: t("paidAtFuture") };

  const refused = refuseNewPayment(d, appt.payments, appt.priceMinor);
  if (refused) return { ok: false, error: await refusalMessage(refused) };

  await writeEntry({
    salonId: session.salonId,
    appointmentId: appt.id,
    kind: "PAYMENT",
    method: d.method,
    amountMinor: d.amountMinor,
    discountMinor: d.discountMinor,
    tipMinor: d.tipMinor,
    paidAt,
    note: d.note ?? null,
    actor: { id: session.user.id, name: session.user.fullName },
    accountId: session.accountId,
    priceMinor: appt.priceMinor,
    before: appt.payments,
  });

  revalidateBookingSurfaces();
  return { ok: true };
}

export async function refundPayment(input: unknown): Promise<ActionResult> {
  const session = await requirePermission("payments.write");
  const t = await getTranslations("Payments.errors");
  const parsed = refundSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;

  const appt = await loadBooking(session.salonId, d.appointmentId);
  if (!appt) return { ok: false, error: t("bookingNotFound") };

  const refused = refuseRefund(d.amountMinor, appt.payments);
  if (refused) return { ok: false, error: await refusalMessage(refused) };

  // A refund is always dated now: it is money leaving the drawer today, whatever
  // day the payment it reverses was taken on.
  await writeEntry({
    salonId: session.salonId,
    appointmentId: appt.id,
    kind: "REFUND",
    method: d.method,
    amountMinor: d.amountMinor,
    discountMinor: 0,
    tipMinor: 0,
    paidAt: new Date(),
    note: d.note ?? null,
    actor: { id: session.user.id, name: session.user.fullName },
    accountId: session.accountId,
    priceMinor: appt.priceMinor,
    before: appt.payments,
  });

  revalidateBookingSurfaces();
  return { ok: true };
}

export async function voidPayment(input: unknown): Promise<ActionResult> {
  const session = await requirePermission("payments.write");
  const t = await getTranslations("Payments.errors");
  const parsed = voidSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { paymentId, reason } = parsed.data;

  const existing = await prisma.appointmentPayment.findFirst({
    where: { id: paymentId, salonId: session.salonId },
    select: {
      id: true,
      appointmentId: true,
      kind: true,
      method: true,
      amountMinor: true,
      discountMinor: true,
      tipMinor: true,
      businessDate: true,
      voidedAt: true,
    },
  });
  if (!existing) return { ok: false, error: t("paymentNotFound") };
  // Voiding twice would overwrite who did it and when, for no change in meaning.
  if (existing.voidedAt) return { ok: false, error: t("alreadyVoided") };

  await prisma.$transaction([
    // salonId in the filter again, and voidedAt null as a compare-and-set: two
    // people voiding the same row at once write it once.
    prisma.appointmentPayment.updateMany({
      where: { id: paymentId, salonId: session.salonId, voidedAt: null },
      data: { voidedAt: new Date(), voidedByUserId: session.user.id, voidReason: reason },
    }),
    prisma.auditLog.create({
      data: {
        accountId: session.accountId!,
        actorUserId: session.user.id,
        action: "payment.void",
        target: paymentId,
        // AuditLog has no salonId column, so the tenant rides in meta — the plan
        // says so, and a money entry with no salon on it is unsearchable.
        meta: {
          salonId: session.salonId,
          appointmentId: existing.appointmentId,
          reason,
          before: {
            kind: existing.kind,
            method: existing.method,
            amountMinor: existing.amountMinor,
            discountMinor: existing.discountMinor,
            tipMinor: existing.tipMinor,
            businessDate: existing.businessDate,
            voidedAt: null,
          },
          after: { voidedAt: new Date().toISOString(), voidReason: reason },
        },
      },
    }),
  ]);

  revalidateBookingSurfaces();
  return { ok: true };
}

/**
 * Write one entry and its audit record together. The two are one transaction on
 * purpose: money that moved with no record of who moved it is exactly what the
 * audit log exists to prevent.
 */
async function writeEntry(args: {
  salonId: string;
  appointmentId: string;
  kind: "PAYMENT" | "REFUND";
  method: (typeof METHODS)[number];
  amountMinor: number;
  discountMinor: number;
  tipMinor: number;
  paidAt: Date;
  note: string | null;
  actor: { id: string; name: string | null };
  accountId: string | null;
  priceMinor: number;
  before: readonly PaymentEntry[];
}): Promise<void> {
  const after = {
    kind: args.kind,
    method: args.method,
    amountMinor: args.amountMinor,
    discountMinor: args.discountMinor,
    tipMinor: args.tipMinor,
    // The Baku day the money moved. This is the PAYMENT day — the shift key in
    // phase 3 — while revenue and payouts follow the booking's day (D7).
    businessDate: bakuYmd(args.paidAt),
    paidAt: args.paidAt.toISOString(),
  };

  await prisma.$transaction(async (tx) => {
    const created = await tx.appointmentPayment.create({
      data: {
        salonId: args.salonId,
        appointmentId: args.appointmentId,
        kind: args.kind,
        method: args.method,
        amountMinor: args.amountMinor,
        discountMinor: args.discountMinor,
        tipMinor: args.tipMinor,
        businessDate: after.businessDate,
        paidAt: args.paidAt,
        // Who took the money. Defaults to whoever is recording it; stored as an
        // id plus a name snapshot, with no FK, so revoking their login later
        // cannot delete the record of who handled the cash.
        receivedByUserId: args.actor.id,
        receivedByName: args.actor.name,
        note: args.note,
        createdByUserId: args.actor.id,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        accountId: args.accountId!,
        actorUserId: args.actor.id,
        action: args.kind === "REFUND" ? "payment.refund" : "payment.create",
        target: created.id,
        meta: {
          salonId: args.salonId,
          appointmentId: args.appointmentId,
          priceMinor: args.priceMinor,
          // What the booking looked like before this entry, as totals rather
          // than a copy of every row: enough to see what changed.
          before: {
            entries: args.before.length,
            liveEntries: args.before.filter((e) => e.voidedAt === null).length,
          },
          after,
        },
      },
    });
  });
}

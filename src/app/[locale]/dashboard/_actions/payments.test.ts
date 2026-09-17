import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@prisma/client";
import { buildSession, type SessionSource } from "@/lib/auth/session-state";

// The payment actions, run through the REAL guards against real sessions. Only
// what reaches outside the process is replaced: the session read, the database,
// next-intl and revalidatePath. Mocking requirePermission itself would test
// nothing — the point of these cases is that finance and a master are refused.

const { getSession, db } = vi.hoisted(() => ({
  getSession: vi.fn(),
  db: {
    appointment: { findFirst: vi.fn() },
    appointmentPayment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "az",
  // Errors come back as their key, so a case can assert WHICH refusal fired.
  getTranslations: async () => (key: string) => key,
}));
// guards.ts imports the locale-aware redirect; the real module reaches into
// next/navigation, which has no server here. No action under test redirects.
vi.mock("@/i18n/navigation", () => ({
  redirect: ({ href }: { href: string }) => {
    throw new Error(`redirect to ${href}`);
  },
}));

import { recordPayment, refundPayment, voidPayment } from "./payments";

const HOME = { id: "salon-1", name: "Salon", address: null };
const PRICE = 4500;

function sessionFor(role: string, plan: Plan = "PRO") {
  const source: SessionSource = {
    user: { id: "user-1", email: "a@b.c", fullName: "Aysel", isPlatformAdmin: false },
    membership: {
      role,
      salonId: HOME.id,
      accountId: "account-1",
      employeeId: role === "STAFF" ? "emp-1" : null,
      disabledAt: null,
      employee: role === "STAFF" ? { isActive: true } : null,
      account: {
        offerVersion: null,
        privacyVersion: null,
        subscription: { extraBranches: 0 },
        salons: [HOME],
      },
    },
    plan,
    branchCookie: undefined,
  };
  return buildSession(source).session;
}

/** A booking in this salon with the given live entries. */
function bookingWith(payments: unknown[] = []) {
  db.appointment.findFirst.mockResolvedValue({ id: APPT, priceMinor: PRICE, payments });
}

const APPT = "11111111-1111-4111-8111-111111111111";
const PAYMENT_ID = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  bookingWith([]);
  // What a booking is left with once the entry under test is voided.
  db.appointmentPayment.findMany.mockResolvedValue([]);
  db.appointmentPayment.create.mockResolvedValue({ id: "new-pay" });
  db.appointmentPayment.updateMany.mockResolvedValue({ count: 1 });
  db.auditLog.create.mockResolvedValue({});
  // Both shapes the actions use: a callback (writeEntry) and an array (void).
  db.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: unknown) => Promise<unknown>)(db) : Promise.all(arg as Promise<unknown>[]),
  );
});

const validPayment = { appointmentId: APPT, method: "CASH", amountMinor: 4500 };

describe("who may take money", () => {
  it.each(["OWNER", "ADMIN"])("%s may record a payment", async (role) => {
    getSession.mockResolvedValue(sessionFor(role));
    await expect(recordPayment(validPayment)).resolves.toEqual({ ok: true });
    expect(db.appointmentPayment.create).toHaveBeenCalledOnce();
  });

  // Finance reads every money screen and touches none of it. The buttons are not
  // rendered for it either, but THIS is the control.
  it("finance may not, although it can read the screen", async () => {
    getSession.mockResolvedValue(sessionFor("FINANCE"));
    await expect(recordPayment(validPayment)).rejects.toThrow("forbidden");
    expect(db.appointmentPayment.create).not.toHaveBeenCalled();
  });

  it("a master may not", async () => {
    getSession.mockResolvedValue(sessionFor("STAFF"));
    await expect(recordPayment(validPayment)).rejects.toThrow("forbidden");
    expect(db.appointmentPayment.create).not.toHaveBeenCalled();
  });

  it.each(["FINANCE", "STAFF"])("%s may not refund or void either", async (role) => {
    getSession.mockResolvedValue(sessionFor(role));
    await expect(refundPayment({ ...validPayment, amountMinor: 100 })).rejects.toThrow("forbidden");
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" })).rejects.toThrow("forbidden");
    expect(db.appointmentPayment.create).not.toHaveBeenCalled();
    expect(db.appointmentPayment.updateMany).not.toHaveBeenCalled();
  });

  // payments.write is gated on the `payments` plan feature, which FREE lacks.
  it("an owner on FREE may not, because the plan has no payments", async () => {
    getSession.mockResolvedValue(sessionFor("OWNER", "FREE"));
    await expect(recordPayment(validPayment)).rejects.toThrow("planRequired");
  });

  it("an owner on START may, the lowest plan that includes payments", async () => {
    getSession.mockResolvedValue(sessionFor("OWNER", "START"));
    await expect(recordPayment(validPayment)).resolves.toEqual({ ok: true });
  });
});

describe("recordPayment", () => {
  beforeEach(() => getSession.mockResolvedValue(sessionFor("OWNER")));

  it("refuses a booking that is not this salon's", async () => {
    db.appointment.findFirst.mockResolvedValue(null);
    await expect(recordPayment(validPayment)).resolves.toEqual({
      ok: false,
      error: "bookingNotFound",
    });
  });

  it("scopes the lookup by salon", async () => {
    await recordPayment(validPayment);
    expect(db.appointment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: APPT, salonId: HOME.id } }),
    );
  });

  it("passes the refusal from the rule functions through", async () => {
    await expect(recordPayment({ ...validPayment, amountMinor: 9999 })).resolves.toEqual({
      ok: false,
      error: "exceedsPrice",
    });
  });

  it("refuses an entry that moves nothing", async () => {
    await expect(recordPayment({ ...validPayment, amountMinor: 0 })).resolves.toEqual({
      ok: false,
      error: "emptyEntry",
    });
  });

  it("records a fully comped booking", async () => {
    await expect(
      recordPayment({ ...validPayment, amountMinor: 0, discountMinor: PRICE }),
    ).resolves.toEqual({ ok: true });
  });

  it("stamps the business date, the actor and who received it", async () => {
    await recordPayment(validPayment);
    expect(db.appointmentPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          salonId: HOME.id,
          kind: "PAYMENT",
          createdByUserId: "user-1",
          receivedByUserId: "user-1",
          receivedByName: "Aysel",
          businessDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      }),
    );
  });

  it("refuses a payment dated in the future", async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString();
    await expect(recordPayment({ ...validPayment, paidAt: tomorrow })).resolves.toEqual({
      ok: false,
      error: "paidAtFuture",
    });
  });

  it("accepts a back-dated payment and dates the business day from it", async () => {
    await expect(
      recordPayment({ ...validPayment, paidAt: "2026-03-04T09:00:00.000Z" }),
    ).resolves.toEqual({ ok: true });
    expect(db.appointmentPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ businessDate: "2026-03-04" }),
      }),
    );
  });

  it("writes an audit entry with the salon, the booking and the new state", async () => {
    await recordPayment(validPayment);
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "payment.create",
          actorUserId: "user-1",
          accountId: "account-1",
          meta: expect.objectContaining({
            salonId: HOME.id,
            appointmentId: APPT,
            after: expect.objectContaining({ amountMinor: 4500, method: "CASH" }),
          }),
        }),
      }),
    );
  });
});

describe("refundPayment", () => {
  beforeEach(() => getSession.mockResolvedValue(sessionFor("OWNER")));

  it("refuses a refund with nothing received", async () => {
    await expect(refundPayment({ ...validPayment, amountMinor: 100 })).resolves.toEqual({
      ok: false,
      error: "refundOnEmpty",
    });
  });

  it("refuses more than was received", async () => {
    bookingWith([{ kind: "PAYMENT", amountMinor: 1000, discountMinor: 0, tipMinor: 0, voidedAt: null }]);
    await expect(refundPayment({ ...validPayment, amountMinor: 2000 })).resolves.toEqual({
      ok: false,
      error: "refundExceedsPaid",
    });
  });

  it("writes a REFUND row with no discount or tip, and its own audit action", async () => {
    bookingWith([{ kind: "PAYMENT", amountMinor: 4500, discountMinor: 0, tipMinor: 0, voidedAt: null }]);
    await expect(refundPayment({ ...validPayment, amountMinor: 1000 })).resolves.toEqual({ ok: true });
    expect(db.appointmentPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ kind: "REFUND", discountMinor: 0, tipMinor: 0 }),
      }),
    );
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: "payment.refund" }) }),
    );
  });
});

describe("voidPayment", () => {
  beforeEach(() => getSession.mockResolvedValue(sessionFor("OWNER")));

  const live = {
    id: PAYMENT_ID,
    appointmentId: APPT,
    kind: "PAYMENT",
    method: "CASH",
    amountMinor: 4500,
    discountMinor: 0,
    tipMinor: 0,
    businessDate: "2026-03-04",
    voidedAt: null,
  };

  it("refuses a payment that is not this salon's", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(null);
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" })).resolves.toEqual({
      ok: false,
      error: "paymentNotFound",
    });
  });

  it("refuses to void twice", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue({ ...live, voidedAt: new Date() });
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" })).resolves.toEqual({
      ok: false,
      error: "alreadyVoided",
    });
  });

  it("requires a reason", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "  " })).resolves.toEqual({
      ok: false,
      error: "invalidData",
    });
  });

  it("stamps who, when and why, and guards on the row still being live", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "səhv məbləğ" })).resolves.toEqual({
      ok: true,
    });
    expect(db.appointmentPayment.updateMany).toHaveBeenCalledWith({
      // voidedAt: null in the filter is the compare-and-set: two people voiding
      // the same row at once write it once.
      where: { id: PAYMENT_ID, salonId: HOME.id, voidedAt: null },
      data: expect.objectContaining({ voidedByUserId: "user-1", voidReason: "səhv məbləğ" }),
    });
  });

  // The review case: take 100, refund 100, then void the payment. The refund
  // would be left standing against money that is no longer recorded.
  it("refuses a void that would leave a refund unopposed", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    db.appointmentPayment.findMany.mockResolvedValue([
      { kind: "REFUND", amountMinor: 4500, discountMinor: 0, tipMinor: 0, voidedAt: null },
    ]);
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" })).resolves.toEqual({
      ok: false,
      error: "voidLeavesNegative",
    });
    expect(db.appointmentPayment.updateMany).not.toHaveBeenCalled();
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("allows the void once the refund itself is gone", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    db.appointmentPayment.findMany.mockResolvedValue([]);
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" })).resolves.toEqual({
      ok: true,
    });
  });

  it("asks only about the booking's other live entries", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    await voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" });
    expect(db.appointmentPayment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          salonId: HOME.id,
          appointmentId: APPT,
          voidedAt: null,
          id: { not: PAYMENT_ID },
        },
      }),
    );
  });

  // Someone else voided it between the read and the write. Nothing changed, so
  // there is nothing to record: an audit entry for a write that did not happen
  // is worse than none.
  it("writes no audit entry when the row was voided by someone else first", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    db.appointmentPayment.updateMany.mockResolvedValue({ count: 0 });
    await expect(voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" })).resolves.toEqual({
      ok: false,
      error: "alreadyVoided",
    });
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });

  it("records the timestamp it actually wrote, not a second one", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    await voidPayment({ paymentId: PAYMENT_ID, reason: "səhv" });
    const written = db.appointmentPayment.updateMany.mock.calls[0][0].data.voidedAt as Date;
    const logged = db.auditLog.create.mock.calls[0][0].data.meta.after.voidedAt as string;
    expect(logged).toBe(written.toISOString());
  });

  it("writes an audit entry carrying the reason and the entry it undid", async () => {
    db.appointmentPayment.findFirst.mockResolvedValue(live);
    await voidPayment({ paymentId: PAYMENT_ID, reason: "səhv məbləğ" });
    expect(db.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "payment.void",
          target: PAYMENT_ID,
          meta: expect.objectContaining({
            salonId: HOME.id,
            reason: "səhv məbləğ",
            before: expect.objectContaining({ amountMinor: 4500 }),
          }),
        }),
      }),
    );
  });
});

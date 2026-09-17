import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildSession, type SessionSource } from "@/lib/auth/session-state";

// deleteCustomer's money rules, through the real guard. The rest of the action —
// reviews, notifications, the settled-payout check — is mocked to the trivial
// case; what is under test is that a customer holding money cannot be erased,
// and that one holding only VOIDED money still can.

const { getSession, db, deleteCustomerReviews } = vi.hoisted(() => ({
  getSession: vi.fn(),
  deleteCustomerReviews: vi.fn(),
  db: {
    customer: { findFirst: vi.fn(), deleteMany: vi.fn() },
    appointmentPayment: { count: vi.fn(), deleteMany: vi.fn() },
    appointment: { findMany: vi.fn(), deleteMany: vi.fn() },
    payout: { findMany: vi.fn() },
    notification: { deleteMany: vi.fn() },
    customerNote: { deleteMany: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/session", () => ({ getSession }));
vi.mock("@/lib/prisma", () => ({ prisma: db }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getLocale: async () => "az",
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/i18n/navigation", () => ({
  redirect: ({ href }: { href: string }) => {
    throw new Error(`redirect to ${href}`);
  },
}));
vi.mock("../../_lib/salon-rating", () => ({ deleteCustomerReviews }));

import { deleteCustomer } from "./actions";

const HOME = { id: "salon-1", name: "Salon", address: null };
const CUSTOMER = "33333333-3333-4333-8333-333333333333";

function ownerSession() {
  const source: SessionSource = {
    user: { id: "user-1", email: "a@b.c", fullName: "Aysel", isPlatformAdmin: false },
    membership: {
      role: "OWNER",
      salonId: HOME.id,
      accountId: "account-1",
      employeeId: null,
      disabledAt: null,
      employee: null,
      account: {
        offerVersion: null,
        privacyVersion: null,
        subscription: { extraBranches: 0 },
        salons: [HOME],
      },
    },
    plan: "PRO",
    branchCookie: undefined,
  };
  return buildSession(source).session;
}

/** live = non-voided payments on their bookings, voided = the undone ones. */
function payments(live: number, voided: number) {
  db.appointmentPayment.count.mockImplementation(
    async ({ where }: { where: { voidedAt: unknown } }) =>
      where.voidedAt === null ? live : voided,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue(ownerSession());
  db.customer.findFirst.mockResolvedValue({ id: CUSTOMER });
  payments(0, 0);
  db.appointment.findMany.mockResolvedValue([]);
  db.payout.findMany.mockResolvedValue([]);
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn(db));
});

describe("deleteCustomer and money", () => {
  it("refuses a customer whose bookings carry live payments", async () => {
    payments(1, 0);
    await expect(deleteCustomer(CUSTOMER)).resolves.toEqual({ ok: false, error: "deletePaid" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("refuses when there is live money alongside voided money", async () => {
    payments(1, 3);
    await expect(deleteCustomer(CUSTOMER)).resolves.toEqual({ ok: false, error: "deletePaid" });
  });

  // The FK is ON DELETE RESTRICT and knows nothing about voiding, so a customer
  // whose payments were all voided used to sail past the old live-only check and
  // into a foreign-key error reported as a generic failure.
  it("deletes a customer whose payments were all voided", async () => {
    payments(0, 2);
    await expect(deleteCustomer(CUSTOMER)).resolves.toEqual({ ok: true });
    expect(db.customer.deleteMany).toHaveBeenCalled();
  });

  it("sweeps the voided rows, and only those", async () => {
    payments(0, 2);
    await deleteCustomer(CUSTOMER);
    expect(db.appointmentPayment.deleteMany).toHaveBeenCalledWith({
      // Never a blanket delete: if a live payment arrived after the count, the
      // FK still refuses and the transaction rolls back, rather than this
      // quietly erasing real money.
      where: { salonId: HOME.id, voidedAt: { not: null }, appointment: { customerId: CUSTOMER } },
    });
  });

  it("touches no payment rows for a customer who never paid", async () => {
    payments(0, 0);
    await expect(deleteCustomer(CUSTOMER)).resolves.toEqual({ ok: true });
    expect(db.appointmentPayment.deleteMany).not.toHaveBeenCalled();
  });

  it("scopes both counts to the salon and the customer's bookings", async () => {
    await deleteCustomer(CUSTOMER);
    expect(db.appointmentPayment.count).toHaveBeenCalledWith({
      where: { salonId: HOME.id, voidedAt: null, appointment: { customerId: CUSTOMER } },
    });
  });
});

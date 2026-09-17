import { describe, it, expect } from "vitest";
import {
  CONTACT_KEYS,
  PAYMENT_KEYS,
  bookingCustomerSelect,
  bookingSelectForViewer,
  bookingViewer,
  canSeeCustomerContact,
  canSeePayments,
  findContactKeys,
  findPaymentKeys,
  serializeBookingForViewer,
  serializeBookingsForViewer,
  type BookingRow,
  type BookingViewer,
  type PaymentRow,
} from "./booking";
import { rolePermissions } from "../auth/permissions";
import { toCalendarBlock } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { toTodayAppointment } from "@/app/[locale]/dashboard/_components/today-shared";

// The rule this file defends: a master never receives a customer's phone number
// — not in a response body, not in a prop, not in the RSC payload that Next.js
// inlines into the dashboard's HTML. "Absent", not "null" and not "***": a key
// that does not exist cannot be read out of View Source, and it is what these
// tests assert on. A master's session is the NO_CONTACT viewer.

const PHONE = "+994501234567";
const DIGITS = "501234567";
// A legacy note: written before the booking endpoints started refusing contacts,
// so it still carries one. The master must get the wish and not the number.
const NOTE = "Zəng edin 0501234567, saç rəngi tünd";
const CLEAN_NOTE = "Tünd çalar, saat 18:30, 2 saat çəkir, 3-cü mərtəbə";

function row(overrides: Partial<BookingRow> = {}): BookingRow {
  return {
    id: "appt-1",
    employeeId: "emp-1",
    startsAt: new Date("2026-03-04T09:00:00.000Z"),
    endsAt: new Date("2026-03-04T10:00:00.000Z"),
    createdAt: new Date("2026-03-01T12:00:00.000Z"),
    status: "CONFIRMED",
    source: "PUBLIC",
    autoCompleted: false,
    priceMinor: 2500,
    manageToken: "3f2b9c11-6a4d-4e0b-9c1f-2d7e5a8b4c60",
    attendeeName: null,
    service: { name: "Saç kəsimi" },
    addons: [],
    employee: { name: "Aysel", position: "Usta" },
    customer: { id: "cust-1", name: "Nigar", phone: PHONE },
    serviceNote: NOTE,
    ...overrides,
  };
}

describe("canSeeCustomerContact", () => {
  it("is false for NO_CONTACT and true for FULL", () => {
    expect(canSeeCustomerContact("NO_CONTACT")).toBe(false);
    expect(canSeeCustomerContact("FULL")).toBe(true);
  });
});

describe("bookingViewer", () => {
  it("withholds contacts from a master", () => {
    expect(bookingViewer({ isAdmin: false, permissions: rolePermissions("MASTER") })).toBe(
      "NO_CONTACT",
    );
  });

  it("gives them to every role that may read the client base", () => {
    for (const role of ["OWNER", "ADMIN", "FINANCE"] as const) {
      expect(bookingViewer({ isAdmin: false, permissions: rolePermissions(role) })).toBe("FULL");
    }
  });

  it("fails closed for a role without clients.read, including one added later", () => {
    expect(bookingViewer({ isAdmin: false, permissions: ["bookings.read", "bookings.write"] })).toBe(
      "NO_CONTACT",
    );
    expect(bookingViewer({ isAdmin: false, permissions: [] })).toBe("NO_CONTACT");
  });

  it("trusts the platform admin, who has no membership and so no permissions", () => {
    expect(bookingViewer({ isAdmin: true, permissions: [] })).toBe("FULL");
  });
});

describe("bookingSelectForViewer", () => {
  it("does not read the customer's phone column for NO_CONTACT", () => {
    const select = bookingSelectForViewer("NO_CONTACT");
    expect(Object.keys(select.customer.select).sort()).toEqual(["id", "name"]);
  });

  it("reads the service note for EVERY viewer — a master needs it to do the job", () => {
    for (const viewer of ["NO_CONTACT", "FULL"] as const) {
      expect(bookingSelectForViewer(viewer)).toMatchObject({ serviceNote: true });
    }
  });

  it("reads the phone for FULL", () => {
    expect(bookingSelectForViewer("FULL").customer.select).toMatchObject({ phone: true });
  });

  it("always reads what every role needs to run the day", () => {
    const select = bookingSelectForViewer("NO_CONTACT");
    expect(select).toMatchObject({
      startsAt: true,
      endsAt: true,
      status: true,
      service: { select: { name: true } },
    });
    expect(select.customer.select).toMatchObject({ name: true });
  });
});

describe("bookingCustomerSelect", () => {
  it("gives NO_CONTACT the identity fields only", () => {
    expect(bookingCustomerSelect("NO_CONTACT")).toEqual({ id: true, name: true });
  });
});

describe("serializeBookingForViewer", () => {
  it("omits the phone entirely for NO_CONTACT", () => {
    const b = serializeBookingForViewer(row(), "NO_CONTACT");
    expect("customerPhone" in b).toBe(false);
    expect(Object.keys(b)).not.toContain("customerPhone");
  });

  it("does not mask, null or blank the phone — the key is gone", () => {
    const b: Record<string, unknown> = { ...serializeBookingForViewer(row(), "NO_CONTACT") };
    expect(b.customerPhone).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain(DIGITS);
    expect(JSON.stringify(b)).not.toContain("***");
  });

  it("still gives a master everything they need: name, service, date and time", () => {
    const b = serializeBookingForViewer(row(), "NO_CONTACT");
    expect(b.customerName).toBe("Nigar");
    expect(b.serviceName).toBe("Saç kəsimi");
    expect(b.startsAt).toEqual(new Date("2026-03-04T09:00:00.000Z"));
    expect(b.endsAt).toEqual(new Date("2026-03-04T10:00:00.000Z"));
  });

  it("uses the attendee's name when the booking is for someone else", () => {
    const b = serializeBookingForViewer(row({ attendeeName: "Leyla" }), "NO_CONTACT");
    expect(b.customerName).toBe("Leyla");
  });

  it("carries the booked add-ons to every viewer — they are part of the job", () => {
    const withAddons = row({ addons: [{ name: "French" }, { name: "Nail art" }] });
    for (const viewer of ["NO_CONTACT", "FULL"] as const) {
      expect(serializeBookingForViewer(withAddons, viewer).addonNames).toEqual([
        "French",
        "Nail art",
      ]);
    }
    expect(serializeBookingForViewer(row(), "NO_CONTACT").addonNames).toEqual([]);
  });

  it("keeps the phone and the raw note for FULL", () => {
    const b = serializeBookingForViewer(row(), "FULL");
    expect(b.customerPhone).toBe(PHONE);
    expect(b.serviceNote).toBe(NOTE);
  });

  it("reports a missing key rather than an undefined value when the query did not read the phone", () => {
    // A FULL call over rows fetched with the NO_CONTACT select. The output must
    // not invent `customerPhone: undefined`, which serializes differently from a
    // field that was never there.
    const b = serializeBookingForViewer(row({ customer: { id: "cust-1", name: "Nigar" } }), "FULL");
    expect("customerPhone" in b).toBe(false);
  });
});

describe("a master's booking API response", () => {
  // The regression test the rule exists for: whatever a booking endpoint hands
  // back for a master's session, JSON-encoded exactly as it would go on the wire,
  // carries no phone and no phone-shaped key at any depth.
  const payload = {
    bookings: serializeBookingsForViewer([row(), row({ id: "appt-2" })], "NO_CONTACT"),
  };

  it("contains none of the contact keys, at any depth", () => {
    expect(findContactKeys(payload)).toEqual([]);
    for (const key of CONTACT_KEYS) {
      expect(JSON.stringify(payload)).not.toContain(`"${key}"`);
    }
  });

  it("contains no digits of the customer's number", () => {
    expect(JSON.stringify(payload)).not.toContain(DIGITS);
    expect(JSON.stringify(payload)).not.toMatch(/\+?994\d{9}/);
  });

  it("still contains the day's work", () => {
    expect(JSON.stringify(payload)).toContain("Nigar");
    expect(JSON.stringify(payload)).toContain("Saç kəsimi");
  });

  it("proves the same check catches a FULL payload (the test is not vacuous)", () => {
    const ownerPayload = { bookings: serializeBookingsForViewer([row()], "FULL") };
    expect(findContactKeys(ownerPayload)).toContain("$.bookings[0].customerPhone");
    expect(JSON.stringify(ownerPayload)).toContain(DIGITS);
  });
});

describe("the props the dashboard streams into its RSC payload", () => {
  const dateLabel = "4 mart";

  function block(viewer: BookingViewer) {
    return toCalendarBlock(serializeBookingForViewer(row(), viewer), "emp-1", dateLabel);
  }
  function todayRow(viewer: BookingViewer) {
    return toTodayAppointment(serializeBookingForViewer(row(), viewer));
  }

  it("builds a calendar block with no phone and a redacted note for a master", () => {
    const b = block("NO_CONTACT");
    expect("customerPhone" in b).toBe(false);
    expect(findContactKeys(b)).toEqual([]);
    expect(JSON.stringify(b)).not.toContain(DIGITS);
    // …and the block is still the master's day, note included.
    expect(b.subtitle).toBe("Nigar");
    expect(b.title).toBe("Saç kəsimi");
    expect(b.serviceNote).toBe("Zəng edin [gizli], saç rəngi tünd");
  });

  it("builds a today row with no phone for a master", () => {
    const r = todayRow("NO_CONTACT");
    expect("clientPhone" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain(DIGITS);
    expect(r.clientName).toBe("Nigar");
    expect(r.priceLabel).toBe("25 ₼");
  });

  it("keeps both intact for FULL, so nothing the owner had is lost", () => {
    expect(block("FULL").customerPhone).toBe(PHONE);
    expect(block("FULL").serviceNote).toBe(NOTE);
    expect(todayRow("FULL").clientPhone).toBe(PHONE);
  });

  it("shows the booked add-ons in the calendar block and the today row", () => {
    const b = serializeBookingForViewer(
      row({ addons: [{ name: "French" }], priceMinor: 3000 }),
      "NO_CONTACT",
    );
    const cal = toCalendarBlock(b, "emp-1", dateLabel);
    expect(cal.title).toBe("Saç kəsimi");
    expect(cal.addons).toEqual(["French"]);
    const today = toTodayAppointment(b);
    expect(today.service).toBe("Saç kəsimi + French");
    // priceMinor is the booking's total, add-ons included.
    expect(today.priceLabel).toBe("30 ₼");
  });
});

describe("the service note a master receives", () => {
  const noteRow = (serviceNote: string) => row({ serviceNote });
  const masterNote = (text: string) =>
    serializeBookingForViewer(noteRow(text), "NO_CONTACT").serviceNote;
  const ownerNote = (text: string) => serializeBookingForViewer(noteRow(text), "FULL").serviceNote;

  it.each([
    ["+994 50 123 45 67 zəng edin", "[gizli] zəng edin"],
    ["0501234567", "[gizli]"],
    ["050 123 45 67", "[gizli]"],
    ["050-123-45-67", "[gizli]"],
    ["yazın ali@mail.ru", "yazın [gizli]"],
    ["instagram @salon_baku", "instagram [gizli]"],
    ["wa.me/994501234567", "[gizli]"],
  ])("redacts the contact in %j before it reaches a master", (input, expected) => {
    expect(masterNote(input)).toBe(expected);
  });

  it("leaves no digit of the number in a master's payload, in any format", () => {
    for (const text of [
      "+994 50 123 45 67",
      "0501234567",
      "050 123 45 67",
      "050-123-45-67",
      "zəng: 050­123­45­67",
    ]) {
      const payload = JSON.stringify(serializeBookingForViewer(noteRow(text), "NO_CONTACT"));
      expect(payload).not.toMatch(/\d{7,}/);
      expect(payload).not.toContain(DIGITS);
      expect(payload).toContain("[gizli]");
    }
  });

  it("does not count a number written in words", () => {
    // "beş yüz…" is prose, not a contact — it must survive untouched.
    expect(masterNote("beş yüz on iki nömrəli çalar")).toBe("beş yüz on iki nömrəli çalar");
  });

  it("leaves an ordinary service note alone — times, durations, floors", () => {
    expect(masterNote(CLEAN_NOTE)).toBe(CLEAN_NOTE);
    expect(masterNote("saat 18:30, 2 saat çəkir, 3-cü mərtəbə")).toBe(
      "saat 18:30, 2 saat çəkir, 3-cü mərtəbə",
    );
    expect(masterNote("15% endirim, 25 AZN")).toBe("15% endirim, 25 AZN");
  });

  it("control: the SAME note reaches the owner untouched", () => {
    for (const text of [
      "+994 50 123 45 67 zəng edin",
      "0501234567",
      "yazın ali@mail.ru",
      "instagram @salon_baku",
      CLEAN_NOTE,
    ]) {
      expect(ownerNote(text)).toBe(text);
    }
    expect(JSON.stringify(serializeBookingForViewer(noteRow("0501234567"), "FULL"))).toContain(
      "0501234567",
    );
  });

  it("passes an empty or missing note through as null, not as [gizli]", () => {
    expect(serializeBookingForViewer(row({ serviceNote: null }), "NO_CONTACT").serviceNote).toBeNull();
    expect(serializeBookingForViewer(row({ serviceNote: "" }), "NO_CONTACT").serviceNote).toBe("");
  });
});

describe("a booking the master entered themselves", () => {
  // The audit scenario: a master types the customer's number into the manual
  // booking form, then opens that same booking in their list and calendar. The
  // rule is the permission, not authorship — having typed it once does not make
  // the number theirs to read back, and a master's device is exactly where a
  // salon's contact list must not accumulate.
  const entered = row({
    source: "DASHBOARD",
    customer: { id: "cust-9", name: "Yeni müştəri", phone: "+994500000199" },
    serviceNote: "tünd çalar",
  });

  it("does not hand the number back on read, however it was written", () => {
    const b = serializeBookingForViewer(entered, "NO_CONTACT");
    expect("customerPhone" in b).toBe(false);
    expect(JSON.stringify(b)).not.toContain("500000199");
    expect(findContactKeys(b)).toEqual([]);
  });

  it("is invisible in the calendar block and the today row too", () => {
    const b = serializeBookingForViewer(entered, "NO_CONTACT");
    const payload = JSON.stringify([
      toCalendarBlock(b, "emp-1", "4 mart"),
      toTodayAppointment(b),
    ]);
    expect(payload).not.toContain("500000199");
    expect(payload).not.toMatch(/\+?994\d{9}/);
    // The service note the master needs is still there.
    expect(payload).toContain("tünd çalar");
  });

  it("control: the owner sees the number on that same booking", () => {
    expect(serializeBookingForViewer(entered, "FULL").customerPhone).toBe("+994500000199");
  });
});

// --- Money -----------------------------------------------------------------
//
// The same rule as the phone number, for a second kind of data and a second
// permission: a master sees no payment information at all, "not even a status
// badge". Absent, not null, not zeroed — a booking with no `payments` key cannot
// leak an amount through the RSC payload, and there is nothing for the UI to
// decide about.

const PAID_ROW: PaymentRow = {
  id: "pay-1",
  kind: "PAYMENT",
  method: "CASH",
  amountMinor: 2000,
  discountMinor: 500,
  tipMinor: 300,
  businessDate: "2026-03-04",
  paidAt: new Date("2026-03-04T10:05:00.000Z"),
  receivedByName: "Aysel",
  note: null,
  voidedAt: null,
  voidReason: null,
};

describe("canSeePayments", () => {
  it("is false for a master, who holds no payments.read", () => {
    expect(canSeePayments({ isAdmin: false, permissions: rolePermissions("MASTER") })).toBe(false);
  });

  it.each(["OWNER", "ADMIN", "FINANCE"] as const)("is true for %s", (role) => {
    expect(canSeePayments({ isAdmin: false, permissions: rolePermissions(role) })).toBe(true);
  });

  it("is true for a platform admin, who has no membership", () => {
    expect(canSeePayments({ isAdmin: true, permissions: [] })).toBe(true);
  });

  // Keyed on its own permission, not on clients.read: the two coincide today and
  // a role added later must not inherit one by holding the other.
  it("does not follow clients.read", () => {
    expect(canSeePayments({ isAdmin: false, permissions: ["clients.read"] })).toBe(false);
    expect(canSeePayments({ isAdmin: false, permissions: ["payments.read"] })).toBe(true);
  });
});

describe("bookingSelectForViewer and payments", () => {
  it("does not read the payment rows unless asked", () => {
    expect(bookingSelectForViewer("FULL")).not.toHaveProperty("payments");
  });

  it("reads them when asked", () => {
    expect(bookingSelectForViewer("FULL", { payments: true })).toHaveProperty("payments");
  });

  // Fail closed by omission: a new surface that forgets the flag gets a booking
  // with no money on it rather than one that leaks it.
  it("defaults to not reading them even for a FULL viewer", () => {
    expect(bookingSelectForViewer("FULL", {})).not.toHaveProperty("payments");
  });
});

describe("serializing the money block", () => {
  const withPayments = () => row({ payments: [PAID_ROW] });

  it("is absent when the caller did not ask", () => {
    const b = serializeBookingForViewer(withPayments(), "FULL");
    expect("payments" in b).toBe(false);
  });

  // Both halves must hold. Asking without selecting must not produce an empty
  // block claiming the booking was never paid.
  it("is absent when the caller asked but the query read nothing", () => {
    const b = serializeBookingForViewer(row(), "FULL", { payments: true });
    expect("payments" in b).toBe(false);
  });

  it("carries the totals from the rule functions when asked", () => {
    const b = serializeBookingForViewer(withPayments(), "FULL", { payments: true });
    expect(b.payments).toMatchObject({
      status: "paid", // 2000 received + 500 discount settles the 2500 price
      netReceivedMinor: 2000,
      settledMinor: 2500,
      remainingMinor: 0,
      tipsMinor: 300,
    });
    expect(b.payments?.entries).toHaveLength(1);
  });

  it("keeps a voided entry in the list but out of the totals", () => {
    const voided: PaymentRow = { ...PAID_ROW, id: "pay-2", voidedAt: new Date(), voidReason: "yanlış" };
    const b = serializeBookingForViewer(row({ payments: [voided] }), "FULL", { payments: true });
    expect(b.payments?.entries).toHaveLength(1);
    expect(b.payments).toMatchObject({ status: "unpaid", netReceivedMinor: 0 });
  });
});

describe("a master's payload carries no money", () => {
  // A master's page never asks for payments, so this is what their booking looks
  // like end to end.
  const payload = {
    bookings: serializeBookingsForViewer([withMoney(), withMoney("appt-2")], "NO_CONTACT"),
  };

  function withMoney(id = "appt-1"): BookingRow {
    return row({ id, payments: [PAID_ROW] });
  }

  it("contains none of the payment keys, at any depth", () => {
    expect(findPaymentKeys(payload)).toEqual([]);
    for (const key of PAYMENT_KEYS) {
      expect(JSON.stringify(payload)).not.toContain(`"${key}"`);
    }
  });

  it("contains no amount that was paid", () => {
    // 2000 / 500 / 300 appear nowhere; the booking's own price (2500) still does,
    // because a master has always seen what the job is worth.
    const json = JSON.stringify(payload);
    expect(json).not.toContain("2000");
    expect(json).not.toContain("pay-1");
    expect(json).toContain("2500");
  });

  it("proves the same check catches a payload that does carry money", () => {
    const owner = {
      bookings: serializeBookingsForViewer([withMoney()], "FULL", { payments: true }),
    };
    expect(findPaymentKeys(owner)).toContain("$.bookings[0].payments");
    expect(JSON.stringify(owner)).toContain("2000");
  });

  it("gives the today row no payment status, so no badge is rendered", () => {
    const todayRow = toTodayAppointment(serializeBookingForViewer(withMoney(), "NO_CONTACT"));
    expect("paymentStatus" in todayRow).toBe(false);
  });

  it("gives the calendar block no payments, so the popup renders no section", () => {
    const b = toCalendarBlock(
      serializeBookingForViewer(withMoney(), "NO_CONTACT"),
      "emp-1",
      "4 mart",
    );
    expect("payments" in b).toBe(false);
  });

  it("carries both through for a viewer who may see them", () => {
    const serialized = serializeBookingForViewer(withMoney(), "FULL", { payments: true });
    expect(toTodayAppointment(serialized).paymentStatus).toBe("paid");
    expect(toCalendarBlock(serialized, "emp-1", "4 mart").payments).toBeDefined();
  });
});

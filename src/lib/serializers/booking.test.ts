import { describe, it, expect } from "vitest";
import {
  CONTACT_KEYS,
  bookingCustomerSelect,
  bookingSelectForRole,
  bookingViewerRole,
  canSeeCustomerContact,
  findContactKeys,
  serializeBookingForRole,
  serializeBookingsForRole,
  type BookingRow,
  type BookingViewerRole,
} from "./booking";
import { toCalendarBlock } from "@/app/[locale]/dashboard/_components/calendar-shared";
import { toTodayAppointment } from "@/app/[locale]/dashboard/_components/today-shared";

// The rule this file defends: a master (STAFF) never receives a customer's
// phone number — not in a response body, not in a prop, not in the RSC payload
// that Next.js inlines into the dashboard's HTML. "Absent", not "null" and not
// "***": a key that does not exist cannot be read out of View Source, and it is
// what these tests assert on.

const PHONE = "+994501234567";
const DIGITS = "501234567";
const NOTE = "Zəng edin 0501234567, saç rəngi tünd";

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
    manageToken: "11111111-2222-3333-4444-555555555555",
    attendeeName: null,
    service: { name: "Saç kəsimi" },
    employee: { name: "Aysel", position: "Usta" },
    customer: { id: "cust-1", name: "Nigar", phone: PHONE },
    notes: NOTE,
    ...overrides,
  };
}

describe("canSeeCustomerContact", () => {
  it("is false for a master and true for the owner and platform admin", () => {
    expect(canSeeCustomerContact("STAFF")).toBe(false);
    expect(canSeeCustomerContact("OWNER")).toBe(true);
    expect(canSeeCustomerContact("ADMIN")).toBe(true);
  });
});

describe("bookingViewerRole", () => {
  it("maps a session to exactly one viewer role", () => {
    expect(bookingViewerRole({ isAdmin: false, isStaff: true })).toBe("STAFF");
    expect(bookingViewerRole({ isAdmin: false, isStaff: false })).toBe("OWNER");
    expect(bookingViewerRole({ isAdmin: true, isStaff: false })).toBe("ADMIN");
  });

  it("treats an admin flag as an admin even alongside a staff membership", () => {
    expect(bookingViewerRole({ isAdmin: true, isStaff: true })).toBe("ADMIN");
  });
});

describe("bookingSelectForRole", () => {
  it("does not read the customer's phone column for a master", () => {
    const select = bookingSelectForRole("STAFF");
    expect(Object.keys(select.customer.select).sort()).toEqual(["id", "name"]);
    // The booking note is customer-typed prose on the public form — a phone
    // number lands in it often enough that it is contact data too.
    expect("notes" in select).toBe(false);
  });

  it("reads the phone and the note for the owner and the platform admin", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const select = bookingSelectForRole(role);
      expect(select.customer.select).toMatchObject({ phone: true });
      expect(select).toMatchObject({ notes: true });
    }
  });

  it("always reads what both roles need to run the day", () => {
    const select = bookingSelectForRole("STAFF");
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
  it("gives a master the identity fields only", () => {
    expect(bookingCustomerSelect("STAFF")).toEqual({ id: true, name: true });
  });
});

describe("serializeBookingForRole", () => {
  it("omits the contact keys entirely for a master", () => {
    const b = serializeBookingForRole(row(), "STAFF");
    expect("customerPhone" in b).toBe(false);
    expect("notes" in b).toBe(false);
    expect(Object.keys(b)).not.toContain("customerPhone");
  });

  it("does not mask, null or blank the phone — the key is gone", () => {
    const b: Record<string, unknown> = { ...serializeBookingForRole(row(), "STAFF") };
    expect(b.customerPhone).toBeUndefined();
    expect(JSON.stringify(b)).not.toContain(DIGITS);
    expect(JSON.stringify(b)).not.toContain("***");
  });

  it("still gives a master everything they need: name, service, date and time", () => {
    const b = serializeBookingForRole(row(), "STAFF");
    expect(b.customerName).toBe("Nigar");
    expect(b.serviceName).toBe("Saç kəsimi");
    expect(b.startsAt).toEqual(new Date("2026-03-04T09:00:00.000Z"));
    expect(b.endsAt).toEqual(new Date("2026-03-04T10:00:00.000Z"));
  });

  it("uses the attendee's name when the booking is for someone else", () => {
    const b = serializeBookingForRole(row({ attendeeName: "Leyla" }), "STAFF");
    expect(b.customerName).toBe("Leyla");
  });

  it("keeps the phone and the note for the owner and the platform admin", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const b = serializeBookingForRole(row(), role);
      expect(b.customerPhone).toBe(PHONE);
      expect(b.notes).toBe(NOTE);
    }
  });

  it("reports a missing key rather than an undefined value when the query did not read the phone", () => {
    // An owner-role call over rows fetched with the master's select. The output
    // must not invent `customerPhone: undefined`, which serializes differently
    // from a field that was never there.
    const b = serializeBookingForRole(
      row({ customer: { id: "cust-1", name: "Nigar" } }),
      "OWNER",
    );
    expect("customerPhone" in b).toBe(false);
  });
});

describe("a master's booking API response", () => {
  // The regression test the rule exists for: whatever a booking endpoint hands
  // back for a STAFF session, JSON-encoded exactly as it would go on the wire,
  // carries no phone and no phone-shaped key at any depth.
  const payload = { bookings: serializeBookingsForRole([row(), row({ id: "appt-2" })], "STAFF") };

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

  it("proves the same check catches an owner payload (the test is not vacuous)", () => {
    const ownerPayload = { bookings: serializeBookingsForRole([row()], "OWNER") };
    expect(findContactKeys(ownerPayload)).toContain("$.bookings[0].customerPhone");
    expect(JSON.stringify(ownerPayload)).toContain(DIGITS);
  });
});

describe("the props the dashboard streams into its RSC payload", () => {
  const dateLabel = "4 mart";

  function block(role: BookingViewerRole) {
    return toCalendarBlock(serializeBookingForRole(row(), role), "emp-1", dateLabel);
  }
  function todayRow(role: BookingViewerRole) {
    return toTodayAppointment(serializeBookingForRole(row(), role));
  }

  it("builds a calendar block with no contact keys for a master", () => {
    const b = block("STAFF");
    expect("customerPhone" in b).toBe(false);
    expect("notes" in b).toBe(false);
    expect(findContactKeys(b)).toEqual([]);
    expect(JSON.stringify(b)).not.toContain(DIGITS);
    // …and the block is still the master's day.
    expect(b.subtitle).toBe("Nigar");
    expect(b.title).toBe("Saç kəsimi");
  });

  it("builds a today row with no phone for a master", () => {
    const r = todayRow("STAFF");
    expect("clientPhone" in r).toBe(false);
    expect(JSON.stringify(r)).not.toContain(DIGITS);
    expect(r.clientName).toBe("Nigar");
    expect(r.priceLabel).toBe("25 ₼");
  });

  it("keeps both intact for the owner, so nothing they had is lost", () => {
    expect(block("OWNER").customerPhone).toBe(PHONE);
    expect(block("OWNER").notes).toBe(NOTE);
    expect(todayRow("OWNER").clientPhone).toBe(PHONE);
  });
});

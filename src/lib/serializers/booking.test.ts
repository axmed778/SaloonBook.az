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
    employee: { name: "Aysel", position: "Usta" },
    customer: { id: "cust-1", name: "Nigar", phone: PHONE },
    serviceNote: NOTE,
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
  });

  it("reads the service note for EVERY role — a master needs it to do the job", () => {
    for (const role of ["STAFF", "OWNER", "ADMIN"] as const) {
      expect(bookingSelectForRole(role)).toMatchObject({ serviceNote: true });
    }
  });

  it("reads the phone for the owner and the platform admin", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      expect(bookingSelectForRole(role).customer.select).toMatchObject({ phone: true });
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
  it("omits the phone entirely for a master", () => {
    const b = serializeBookingForRole(row(), "STAFF");
    expect("customerPhone" in b).toBe(false);
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

  it("keeps the phone and the raw note for the owner and the platform admin", () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      const b = serializeBookingForRole(row(), role);
      expect(b.customerPhone).toBe(PHONE);
      expect(b.serviceNote).toBe(NOTE);
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

  it("builds a calendar block with no phone and a redacted note for a master", () => {
    const b = block("STAFF");
    expect("customerPhone" in b).toBe(false);
    expect(findContactKeys(b)).toEqual([]);
    expect(JSON.stringify(b)).not.toContain(DIGITS);
    // …and the block is still the master's day, note included.
    expect(b.subtitle).toBe("Nigar");
    expect(b.title).toBe("Saç kəsimi");
    expect(b.serviceNote).toBe("Zəng edin [gizli], saç rəngi tünd");
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
    expect(block("OWNER").serviceNote).toBe(NOTE);
    expect(todayRow("OWNER").clientPhone).toBe(PHONE);
  });
});

describe("the service note a master receives", () => {
  const noteRow = (serviceNote: string) => row({ serviceNote });
  const staffNote = (text: string) =>
    serializeBookingForRole(noteRow(text), "STAFF").serviceNote;
  const ownerNote = (text: string) =>
    serializeBookingForRole(noteRow(text), "OWNER").serviceNote;

  it.each([
    ["+994 50 123 45 67 zəng edin", "[gizli] zəng edin"],
    ["0501234567", "[gizli]"],
    ["050 123 45 67", "[gizli]"],
    ["050-123-45-67", "[gizli]"],
    ["yazın ali@mail.ru", "yazın [gizli]"],
    ["instagram @salon_baku", "instagram [gizli]"],
    ["wa.me/994501234567", "[gizli]"],
  ])("redacts the contact in %j before it reaches a master", (input, expected) => {
    expect(staffNote(input)).toBe(expected);
  });

  it("leaves no digit of the number in a master's payload, in any format", () => {
    for (const text of [
      "+994 50 123 45 67",
      "0501234567",
      "050 123 45 67",
      "050-123-45-67",
      "zəng: 050­123­45­67",
    ]) {
      const payload = JSON.stringify(serializeBookingForRole(noteRow(text), "STAFF"));
      expect(payload).not.toMatch(/\d{7,}/);
      expect(payload).not.toContain(DIGITS);
      expect(payload).toContain("[gizli]");
    }
  });

  it("does not count a number written in words", () => {
    // "beş yüz…" is prose, not a contact — it must survive untouched.
    expect(staffNote("beş yüz on iki nömrəli çalar")).toBe("beş yüz on iki nömrəli çalar");
  });

  it("leaves an ordinary service note alone — times, durations, floors", () => {
    expect(staffNote(CLEAN_NOTE)).toBe(CLEAN_NOTE);
    expect(staffNote("saat 18:30, 2 saat çəkir, 3-cü mərtəbə")).toBe(
      "saat 18:30, 2 saat çəkir, 3-cü mərtəbə",
    );
    expect(staffNote("15% endirim, 25 AZN")).toBe("15% endirim, 25 AZN");
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
    expect(JSON.stringify(serializeBookingForRole(noteRow("0501234567"), "OWNER"))).toContain(
      "0501234567",
    );
  });

  it("passes an empty or missing note through as null, not as [gizli]", () => {
    expect(serializeBookingForRole(row({ serviceNote: null }), "STAFF").serviceNote).toBeNull();
    expect(serializeBookingForRole(row({ serviceNote: "" }), "STAFF").serviceNote).toBe("");
  });
});

describe("a booking the master entered themselves", () => {
  // The audit scenario: a master types the customer's number into the manual
  // booking form, then opens that same booking in their list and calendar. The
  // rule is the ROLE, not authorship — having typed it once does not make the
  // number theirs to read back, and a master's device is exactly where a
  // salon's contact list must not accumulate.
  const entered = row({
    source: "DASHBOARD",
    customer: { id: "cust-9", name: "Yeni müştəri", phone: "+994500000199" },
    serviceNote: "tünd çalar",
  });

  it("does not hand the number back on read, however it was written", () => {
    const b = serializeBookingForRole(entered, "STAFF");
    expect("customerPhone" in b).toBe(false);
    expect(JSON.stringify(b)).not.toContain("500000199");
    expect(findContactKeys(b)).toEqual([]);
  });

  it("is invisible in the calendar block and the today row too", () => {
    const b = serializeBookingForRole(entered, "STAFF");
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
    expect(serializeBookingForRole(entered, "OWNER").customerPhone).toBe("+994500000199");
  });
});

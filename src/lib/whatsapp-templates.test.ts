import { describe, it, expect } from "vitest";
import { buildComponents } from "./whatsapp-templates";
import { formatBakuDateTime } from "./time";

// These tests PIN the Meta template contract: the order of body params and the
// presence/target of the URL button. They must stay in lockstep with the
// templates registered in Meta (docs/whatsapp-templates.md). If you change a
// template's variable order or button, change it here AND in the doc AND in Meta
// — a silent drift breaks every send of that template once we go live.

const ISO = "2026-07-22T10:30:00.000Z";
const WHEN = formatBakuDateTime(new Date(ISO));
const APPT = { manageToken: "tok-123", salonSlug: "nergiz-beauty" };

// Narrow the `unknown` return into the concrete Meta shape for assertions.
type BodyComp = { type: "body"; parameters: { type: "text"; text: string }[] };
type BtnComp = {
  type: "button";
  sub_type: "url";
  index: "0";
  parameters: { type: "text"; text: string }[];
};
function comps(v: unknown): Array<BodyComp | BtnComp> {
  return v as Array<BodyComp | BtnComp>;
}
function bodyTexts(v: unknown): string[] {
  const body = comps(v).find((c) => c.type === "body") as BodyComp | undefined;
  return body ? body.parameters.map((p) => p.text) : [];
}
function button(v: unknown): BtnComp | undefined {
  return comps(v).find((c) => c.type === "button") as BtnComp | undefined;
}

describe("buildComponents — customer templates ({{1}} salon, {{2}} service, {{3}} when)", () => {
  const payload = { salon: "Nərgiz Beauty", service: "Saç kəsimi", startsAt: ISO };

  it("booking_confirmation: body order + manage-link button", () => {
    const c = buildComponents("booking_confirmation", payload, APPT);
    expect(bodyTexts(c)).toEqual(["Nərgiz Beauty", "Saç kəsimi", WHEN]);
    expect(button(c)).toEqual({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: "tok-123" }],
    });
  });

  it("appointment_reminder: same body, manage-link button", () => {
    const c = buildComponents("appointment_reminder", payload, APPT);
    expect(bodyTexts(c)).toEqual(["Nərgiz Beauty", "Saç kəsimi", WHEN]);
    expect(button(c)?.parameters[0].text).toBe("tok-123");
  });

  it("appointment_cancelled: body + rebook button links to the salon slug", () => {
    const c = buildComponents("appointment_cancelled", payload, APPT);
    expect(bodyTexts(c)).toEqual(["Nərgiz Beauty", "Saç kəsimi", WHEN]);
    expect(button(c)?.parameters[0].text).toBe("nergiz-beauty");
  });
});

describe("buildComponents — owner templates ({{1}} customer, {{2}} service, {{3}} when)", () => {
  const payload = { customer: "Aygün", service: "Manikür", startsAt: ISO };

  for (const template of [
    "new_booking_alert",
    "booking_cancelled_alert",
    "appointment_rescheduled_alert",
  ]) {
    it(`${template}: customer-first body, NO url button`, () => {
      const c = buildComponents(template, payload, APPT);
      expect(bodyTexts(c)).toEqual(["Aygün", "Manikür", WHEN]);
      expect(button(c)).toBeUndefined();
    });
  }
});

describe("buildComponents — hardening", () => {
  it("sanitizes newline/tab/control chars out of every body param", () => {
    const c = buildComponents(
      "booking_confirmation",
      { salon: "Ali\nSalon", service: "Saç\t\t  kəsimi", startsAt: ISO },
      APPT,
    );
    const [salon, service] = bodyTexts(c);
    expect(salon).toBe("Ali Salon");
    expect(service).toBe("Saç kəsimi");
    expect(salon).not.toMatch(/[\n\t]/);
    expect(service).not.toMatch(/[\n\t]/);
  });

  it("omits the button when no appointment context is supplied", () => {
    const c = buildComponents("booking_confirmation", { salon: "S", service: "X", startsAt: ISO }, null);
    expect(button(c)).toBeUndefined();
    expect(bodyTexts(c)).toEqual(["S", "X", WHEN]);
  });

  it("missing payload fields degrade to empty strings, not 'undefined'", () => {
    const c = buildComponents("booking_confirmation", {}, null);
    expect(bodyTexts(c)).toEqual(["", "", ""]);
  });

  it("returns undefined for an unknown template (no variables)", () => {
    expect(buildComponents("totally_unknown", { salon: "S" }, APPT)).toBeUndefined();
  });
});

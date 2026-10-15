import { describe, expect, it } from "vitest";
import { describeDeliveryFailure } from "./whatsapp-status";

describe("describeDeliveryFailure", () => {
  it("keeps Meta's code and wording", () => {
    expect(
      describeDeliveryFailure([
        {
          code: 131026,
          title: "Message undeliverable",
          message: "Message undeliverable",
          error_data: { details: "Recipient is not a WhatsApp user" },
        },
      ]),
    ).toBe(
      "Meta delivery failed (#131026): Message undeliverable — Recipient is not a WhatsApp user",
    );
  });

  it("still says something when Meta gives no errors", () => {
    expect(describeDeliveryFailure(undefined)).toBe("Meta delivery failed (no reason given)");
    expect(describeDeliveryFailure([])).toBe("Meta delivery failed (no reason given)");
  });

  it("handles a code with no text", () => {
    expect(describeDeliveryFailure([{ code: 131049 }])).toBe("Meta delivery failed (#131049)");
  });

  it("caps the length", () => {
    const long = "x".repeat(2000);
    expect(describeDeliveryFailure([{ code: 1, title: long }]).length).toBe(500);
  });
});

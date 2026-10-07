import { describe, expect, it } from "vitest";
import { isNativeAppUserAgent } from "./native-app";

describe("isNativeAppUserAgent", () => {
  it("recognises the iOS app's user agent", () => {
    expect(
      isNativeAppUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 SalonBookApp/ios",
      ),
    ).toBe(true);
  });

  it("does not match Safari or a missing header", () => {
    expect(
      isNativeAppUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      ),
    ).toBe(false);
    expect(isNativeAppUserAgent(null)).toBe(false);
    expect(isNativeAppUserAgent(undefined)).toBe(false);
  });
});

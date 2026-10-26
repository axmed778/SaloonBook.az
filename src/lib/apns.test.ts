import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { apnsPayload, sendApnsPush, signProviderToken } from "./apns";

describe("signProviderToken", () => {
  it("produces an ES256 JWT that verifies against the key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const jwt = signProviderToken(
      { keyId: "ABC123DEFG", teamId: "TEAM123456", privateKey: pem },
      1_760_000_000_000,
    );

    const [header, claims, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "ES256",
      kid: "ABC123DEFG",
    });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
      iss: "TEAM123456",
      iat: 1_760_000_000,
    });
    const ok = createVerify("SHA256")
      .update(`${header}.${claims}`)
      .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
    expect(ok).toBe(true);
  });
});

describe("apnsPayload", () => {
  it("puts the text in aps.alert and the link next to it", () => {
    expect(
      JSON.parse(apnsPayload({ title: "Yeni rezervasiya", body: "Aynur · 14:00", url: "/x" })),
    ).toEqual({
      aps: { alert: { title: "Yeni rezervasiya", body: "Aynur · 14:00" }, sound: "default" },
      url: "/x",
    });
  });
});

describe("sendApnsPush", () => {
  it("only logs when no APNs key is configured", async () => {
    const res = await sendApnsPush("ab".repeat(32), { title: "t", body: "b" });
    expect(res).toEqual({ ok: true, sandbox: true });
  });
});

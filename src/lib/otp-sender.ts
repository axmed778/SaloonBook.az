// Delivers OTP codes over a channel. WhatsApp first (reuses the existing Meta
// Cloud API + platform number); SMS as a fallback for numbers not on WhatsApp
// (or when the user explicitly asks). Provider-agnostic: the SMS adapter here is
// Twilio via its REST API (no SDK dependency), and stays dormant until creds are
// set — swap trySendSms for a local Azerbaijani gateway without touching callers.
//
// "Never log codes": in production the code only ever leaves via a configured
// channel. The single dev-only code log (unconfigured channels) is guarded by
// NODE_ENV so it can never fire in production.
import { sendWhatsAppTemplate } from "./whatsapp";

export type OtpChannel = "whatsapp" | "sms";

export interface SendOtpResult {
  channel: OtpChannel;
  // true when no real channel was configured (dev). Callers must not expose this.
  sandbox: boolean;
}

const OTP_TEMPLATE = process.env.WHATSAPP_OTP_TEMPLATE?.trim() || "otp_code";

// Meta authentication-template components: the code fills the body {{1}} and the
// one-tap/autofill URL button. Must match the approved template in Meta.
function otpComponents(code: string): unknown {
  return [
    { type: "body", parameters: [{ type: "text", text: code }] },
    { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: code }] },
  ];
}

async function trySendWhatsApp(phone: string, code: string): Promise<"sent" | "unconfigured" | "failed"> {
  // Only attempt a real send when the platform WhatsApp number is configured —
  // otherwise sendWhatsAppTemplate would sandbox-LOG the code, which we forbid.
  if (!process.env.WHATSAPP_TOKEN?.trim() || !process.env.WHATSAPP_PHONE_NUMBER_ID?.trim()) {
    return "unconfigured";
  }
  try {
    await sendWhatsAppTemplate({
      toPhone: phone,
      template: OTP_TEMPLATE,
      languageCode: "az",
      components: otpComponents(code),
    });
    return "sent";
  } catch (e) {
    // Includes "not a WhatsApp user" (Meta 131026/131047) and transient errors —
    // in every case we fall back to SMS.
    console.error("[otp] whatsapp send failed, falling back to sms:", (e as Error).message);
    return "failed";
  }
}

async function trySendSms(phone: string, code: string): Promise<"sent" | "unconfigured"> {
  const sid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  const from = process.env.TWILIO_FROM?.trim();
  if (!sid || !token || !from) return "unconfigured";

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: phone,
      From: from,
      Body: `SalonBook.az təsdiq kodunuz: ${code}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`SMS send failed (${res.status}): ${await res.text()}`);
  }
  return "sent";
}

/**
 * Send `code` to `phone`. Tries WhatsApp unless forceSms; falls back to SMS.
 * Returns the channel actually used. Throws only when a channel was configured
 * but failed to send (so the caller can surface an error) — never logs the code.
 */
export async function sendOtp(
  phone: string,
  code: string,
  opts: { forceSms?: boolean } = {},
): Promise<SendOtpResult> {
  if (!opts.forceSms) {
    const wa = await trySendWhatsApp(phone, code);
    if (wa === "sent") return { channel: "whatsapp", sandbox: false };
    // "failed" or "unconfigured" → try SMS below.
  }

  const sms = await trySendSms(phone, code);
  if (sms === "sent") return { channel: "sms", sandbox: false };

  // No channel configured. Dev only: surface the code once so local sign-in
  // works. NEVER reached in production (a channel is configured, or the WA/SMS
  // send threw above and propagated to the caller).
  if (process.env.NODE_ENV !== "production") {
    console.log(`[otp:dev] ${phone} -> ${code}`);
    return { channel: opts.forceSms ? "sms" : "whatsapp", sandbox: true };
  }
  throw new Error("No OTP delivery channel configured (WhatsApp/SMS)");
}

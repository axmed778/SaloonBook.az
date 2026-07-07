// Transactional email via Resend's REST API — plain fetch, no SDK dependency
// (mirrors the WhatsApp sender's approach). With RESEND_API_KEY unset the
// sender runs in sandbox mode: the email is logged, not sent, so local dev
// needs no key. EMAIL_FROM must be a Resend-verified sender in production;
// the default onboarding@resend.dev works out of the box for testing.

const RESEND_API = "https://api.resend.com/emails";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
}

/** Returns true if the email was accepted (or sandbox-logged). Never throws. */
export async function sendEmail({ to, subject, html }: SendEmailInput): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "SalonBook <onboarding@resend.dev>";

  if (!apiKey) {
    console.warn(`[email] sandbox (RESEND_API_KEY unset) — would send to ${to}: ${subject}`);
    console.warn(`[email] body: ${html}`);
    return true;
  }

  try {
    const res = await fetch(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[email] resend ${res.status}: ${body.slice(0, 500)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] send failed", e);
    return false;
  }
}

// Thin wrapper over the Meta WhatsApp Cloud API. In dev (no WHATSAPP_TOKEN) it
// runs in sandbox mode: messages are logged, not sent — so you never burn real
// template sends or need Meta approval to develop the booking flow.
//
// Business-initiated WhatsApp messages MUST use pre-approved templates. The
// `template` name + `components` are submitted to / approved by Meta separately.

const GRAPH_VERSION = "v21.0";

/**
 * Sanitize a client-supplied string before it becomes a WhatsApp template
 * variable. Meta rejects template params containing newlines, tabs, or runs of
 * 4+ spaces, and we never want raw control characters flowing into the owner's
 * alert (or, later, the dashboard). Strips control chars, collapses whitespace,
 * trims, and bounds length. This is defense at the boundary; render sites must
 * still escape (React does so by default).
 */
export function sanitizeTemplateParam(input: string, maxLen = 120): string {
  return input
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, " ") // control chars -> space
    .replace(/\s+/g, " ") // collapse whitespace (incl. newlines/tabs)
    .trim()
    .slice(0, maxLen);
}

export interface SendTemplateInput {
  toPhone: string; // E.164, e.g. +994501234567
  template: string; // approved template name
  languageCode?: string; // "az" | "ru"
  // Template variable components; shape per Meta's API.
  components?: unknown;
  // Sender credentials. When provided (e.g. a PRO salon's own number, resolved
  // by src/lib/whatsapp-sender.ts) they override the platform env defaults. When
  // omitted we fall back to WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID, and when
  // neither resolves we run in sandbox (log-only) mode — unchanged behavior.
  token?: string;
  phoneNumberId?: string;
}

export interface SendResult {
  sandbox: boolean;
  providerMsgId?: string;
}

export async function sendWhatsAppTemplate(input: SendTemplateInput): Promise<SendResult> {
  const token = input.token ?? process.env.WHATSAPP_TOKEN;
  const phoneNumberId = input.phoneNumberId ?? process.env.WHATSAPP_PHONE_NUMBER_ID;

  if (!token || !phoneNumberId) {
    console.log(
      `[whatsapp:sandbox] -> ${input.toPhone} template=${input.template}`,
      JSON.stringify(input.components ?? {}),
    );
    return { sandbox: true };
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: input.toPhone.replace(/[^\d]/g, ""),
        type: "template",
        template: {
          name: input.template,
          language: { code: input.languageCode ?? "az" },
          ...(input.components ? { components: input.components } : {}),
        },
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp send failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { messages?: Array<{ id?: string }> };
  return { sandbox: false, providerMsgId: data.messages?.[0]?.id };
}

export interface WhatsAppNumberInfo {
  verifiedName?: string;
  displayPhone?: string;
}

/**
 * Fetch a WhatsApp phone number's public info from Meta, used to VALIDATE a
 * salon's own-number credentials before activating them: a successful call
 * proves the token can act on that phone_number_id. Throws on any non-2xx so the
 * admin action can keep the sender PENDING and surface the error.
 */
export async function fetchWhatsAppNumberInfo(
  token: string,
  phoneNumberId: string,
): Promise<WhatsAppNumberInfo> {
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}` +
      `?fields=verified_name,display_phone_number`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WhatsApp number validation failed (${res.status}): ${body}`);
  }
  const data = (await res.json()) as {
    verified_name?: string;
    display_phone_number?: string;
  };
  return {
    verifiedName: data.verified_name,
    displayPhone: data.display_phone_number,
  };
}

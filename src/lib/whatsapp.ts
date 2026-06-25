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
}

export interface SendResult {
  sandbox: boolean;
  providerMsgId?: string;
}

export async function sendWhatsAppTemplate(input: SendTemplateInput): Promise<SendResult> {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

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

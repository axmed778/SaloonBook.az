// Thin wrapper over the Meta WhatsApp Cloud API. In dev (no WHATSAPP_TOKEN) it
// runs in sandbox mode: messages are logged, not sent — so you never burn real
// template sends or need Meta approval to develop the booking flow.
//
// Business-initiated WhatsApp messages MUST use pre-approved templates. The
// `template` name + `components` are submitted to / approved by Meta separately.

const GRAPH_VERSION = "v21.0";

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

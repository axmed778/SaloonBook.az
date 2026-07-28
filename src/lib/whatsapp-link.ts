// Click-to-chat WhatsApp deep links (wa.me).
//
// UNLIKE the Meta Cloud API templates in whatsapp-templates.ts (business-
// initiated, pre-approved, sent by the worker), these open the STAFF member's
// own WhatsApp with a prefilled message they send by hand. No Meta approval, no
// template, no quota — just a link. Used by the dashboard "Mesaj" button.
//
// The messages live here as one i18n-able constants module (functions of vars),
// so they can later move behind next-intl without changing call sites.

export type WhatsAppTemplateKey =
  | "bookingConfirmed"
  | "reminder"
  | "rescheduleRequest"
  | "reviewRequest";

export interface WhatsAppTemplateVars {
  /** Salon name. */
  salon?: string;
  /** Service name. */
  service?: string;
  /** Human date/time, already formatted (e.g. "22 iyul, 14:30"). */
  when?: string;
  /** Who the booking is for (attendee/customer name). */
  client?: string;
  /** Optional link (e.g. a review or manage URL). */
  link?: string;
}

// A friendly greeting that only includes the name when we have one.
const hi = (client?: string) => (client ? `Salam, ${client}!` : "Salam!");

// Azerbaijani message templates. Booking confirmed, reminder, reschedule
// request, and thank-you/review request.
export const WA_TEMPLATES: Record<
  WhatsAppTemplateKey,
  (v: WhatsAppTemplateVars) => string
> = {
  bookingConfirmed: (v) =>
    `${hi(v.client)} ${v.salon ?? "Salonumuz"}da ${v.service ?? "xidmət"} rezervasiyanız` +
    `${v.when ? ` ${v.when} üçün` : ""} təsdiqləndi. Gözləyirik! 🌸`,
  reminder: (v) =>
    `${hi(v.client)} ${v.when ? `${v.when} tarixindəki ` : ""}${v.service ?? "xidmət"} ` +
    `görüşünüzü xatırladırıq. ${v.salon ?? "Salonumuz"}`,
  rescheduleRequest: (v) =>
    `${hi(v.client)} ${v.service ?? "xidmət"} görüşünüzün` +
    `${v.when ? ` (${v.when})` : ""} vaxtını dəyişmək lazımdır. Sizə uyğun vaxtı bildirə bilərsinizmi?`,
  reviewRequest: (v) =>
    `${hi(v.client)} ${v.salon ?? "Salonumuz"}a gəldiyiniz üçün təşəkkür edirik. ` +
    `Xidmətimizi dəyərləndirsəniz çox sevinərik${v.link ? `: ${v.link}` : "! 🌟"}`,
};

/**
 * Build a wa.me click-to-chat link.
 *  - Strips ALL non-digits from the phone (no leading +, spaces, or dashes).
 *  - URL-encodes the prefilled message.
 *
 * @example
 * buildWhatsAppLink("+994 50 123 45 67", "reviewRequest", { salon: "Nərgiz" })
 * // "https://wa.me/994501234567?text=..."
 */
export function buildWhatsAppLink(
  phoneE164: string,
  template: WhatsAppTemplateKey,
  vars: WhatsAppTemplateVars = {},
): string {
  const digits = phoneE164.replace(/\D/g, "");
  const text = WA_TEMPLATES[template](vars);
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

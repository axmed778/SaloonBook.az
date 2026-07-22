// The ONE place that maps a persisted Notification (template name + payload) to
// Meta's template `components` array. Kept as a pure, side-effect-free module
// (no Prisma/queue imports) so the contract can be unit-tested in isolation —
// see whatsapp-templates.test.ts. The worker (worker/processors/notifications.ts)
// is the only runtime caller.
//
// CONTRACT: the ORDER of the body params below MUST match the {{1}}, {{2}}, {{3}}
// placeholders in the approved Meta template of the same name, and the URL-button
// presence/index MUST match the template's button — see docs/whatsapp-templates.md.
// A mismatch fails EVERY send of that template (component error), so the tests in
// whatsapp-templates.test.ts pin this shape; change them and the doc together.

import type { Prisma } from "@prisma/client";
import { formatBakuDateTime } from "./time";
import { sanitizeTemplateParam } from "./whatsapp";

export interface TemplateAppt {
  manageToken: string;
  salonSlug: string;
}

/**
 * Build the Meta `components` payload for a template + notification payload.
 * Returns undefined for templates that take no variables.
 */
export function buildComponents(
  template: string,
  payload: Prisma.JsonValue,
  appt: TemplateAppt | null,
): unknown {
  const p = (payload ?? {}) as Record<string, unknown>;
  const when = typeof p.startsAt === "string" ? formatBakuDateTime(new Date(p.startsAt)) : "";

  let params: string[];
  switch (template) {
    // To customer — {{1}} salon, {{2}} service, {{3}} when
    case "booking_confirmation":
    case "appointment_reminder":
    case "appointment_cancelled": // salon cancelled the customer's appointment
      params = [String(p.salon ?? ""), String(p.service ?? ""), when];
      break;
    // To owner — {{1}} customer, {{2}} service, {{3}} when
    case "new_booking_alert":
    case "booking_cancelled_alert": // customer cancelled via the manage link
    case "appointment_rescheduled_alert": // customer moved the appointment via the manage link
      params = [String(p.customer ?? ""), String(p.service ?? ""), when];
      break;
    default:
      params = [];
  }

  const components: unknown[] = [];
  if (params.length > 0) {
    components.push({
      type: "body",
      // Sanitize every body param centrally: names come from salon/service/
      // customer records (incl. staff-entered dashboard values) that can contain
      // newlines/tabs/control chars, which Meta rejects with a component-mismatch
      // error — silently failing the send. Single choke point so no creation
      // site can leak an unsanitized param into a template.
      parameters: params.map((text) => ({ type: "text", text: sanitizeTemplateParam(text) })),
    });
  }

  // Customer-facing templates carry a dynamic URL button (part of the approved
  // template; the code only supplies the URL suffix): confirmation and reminder
  // deep-link to the self-service manage page (/a/{token}) so the customer can
  // cancel or reschedule; the cancellation notice links back to the salon's
  // booking page (/{slug}) so they can rebook.
  if (appt) {
    if (template === "booking_confirmation" || template === "appointment_reminder") {
      components.push(urlButton(appt.manageToken));
    } else if (template === "appointment_cancelled") {
      components.push(urlButton(appt.salonSlug));
    }
  }

  return components.length > 0 ? components : undefined;
}

// Meta's shape for filling a template's dynamic-URL button: the text becomes
// the {{1}} suffix of the button URL defined on the template.
function urlButton(urlSuffix: string): unknown {
  return {
    type: "button",
    sub_type: "url",
    index: "0",
    parameters: [{ type: "text", text: urlSuffix }],
  };
}

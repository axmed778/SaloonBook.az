// Meta delivery-status helpers for the WhatsApp webhook.
//
// PURE: no Prisma, no env, so the unit suite covers it.

/** One entry of `statuses[].errors` in a Meta webhook callback. */
export type MetaStatusError = {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
};

/**
 * The reason Meta gave for a "failed" status, as a short line for the
 * Notification row's lastError. Without it a row that Meta accepted and then
 * failed to deliver carries no explanation at all, and the only way to learn
 * why is to replay the webhook.
 */
export function describeDeliveryFailure(errors: unknown): string {
  const list = Array.isArray(errors) ? (errors as MetaStatusError[]) : [];
  const first = list.find((e) => e && typeof e === "object");
  if (!first) return "Meta delivery failed (no reason given)";

  const code = typeof first.code === "number" ? ` (#${first.code})` : "";
  const parts = [first.title, first.message, first.error_data?.details]
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    // Meta often repeats the title as the message; keep each wording once.
    .filter((p, i, all) => all.indexOf(p) === i);
  const reason = parts.length > 0 ? `: ${parts.join(" — ")}` : "";
  return `Meta delivery failed${code}${reason}`.slice(0, 500);
}

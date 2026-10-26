// Azerbaijani phone input. Every phone field shows a fixed "+994" prefix and
// takes the 9-digit national number after it (e.g. 501234567). People often
// type the number the way they dial it locally, with the trunk 0 in front
// (0501234567): the field used to keep the first 9 digits, so the 0 stayed,
// the last digit was cut off, and the booking saved +994050123456 — a number
// no WhatsApp message can reach (Meta #131026, "Message undeliverable").

/** Stored/submitted format: +994 and a 9-digit national number, which never starts with 0. */
export const AZ_PHONE_RE = /^\+994[1-9]\d{8}$/;

/**
 * Normalizes what was typed or pasted into a "+994" phone field to at most 9
 * national digits: drops non-digits, a pasted country code (+994 / 00994) and
 * the local trunk 0.
 */
export function azLocalDigits(input: string): string {
  let digits = input.replace(/\D/g, "");
  // Only a full international number is longer than 9 digits; a 9-digit
  // national number may itself start with 994 (e.g. 994123456 on the 99 prefix).
  if (digits.length >= 12) digits = digits.replace(/^(00)?994/, "");
  return digits.replace(/^0+/, "").slice(0, 9);
}

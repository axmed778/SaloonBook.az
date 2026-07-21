// Resolves WHICH WhatsApp number a given salon's messages go out from — the one
// decision point for the PRO "own number" feature. Everything else (worker send
// path, webhook routing, billing UI) reads through here.
//
// Default: the shared platform number (env WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID).
// A PRO salon whose WhatsAppSender is ACTIVE and has stored credentials sends
// from ITS own number instead. The plan gate (featuresFor(plan).ownWhatsappNumber)
// is the source of truth: a non-Pro plan ALWAYS falls back to the platform number,
// even if credentials happen to be filled in and ACTIVE.

import type { Prisma, WhatsAppSenderStatus } from "@prisma/client";
import { prisma } from "./prisma";
import { decryptSecret } from "./crypto";
import { featuresFor } from "./plans";
import { effectivePlan, type SubscriptionLike } from "./subscription";

export interface ResolvedSender {
  /** undefined token/phoneNumberId → sendWhatsAppTemplate runs in sandbox mode. */
  token: string | undefined;
  phoneNumberId: string | undefined;
  /**
   * True when the message is sent from the SALON's own number (the salon pays
   * Meta directly). Quota accounting must treat these as unlimited — see the
   * note in decideSender() and docs/own-number.md. False = platform number.
   */
  ownNumber: boolean;
}

/**
 * PURE gating decision, split out so it can be unit-tested without a DB (the rest
 * of resolveWhatsAppSender is I/O — Prisma + token decryption).
 *
 * Returns "salon" only when ALL hold:
 *   - the plan entitles the salon to its own number (Pro), AND
 *   - the sender row is ACTIVE, AND
 *   - both credentials (phone_number_id + encrypted token) are present.
 * Otherwise "platform" — the safe default.
 *
 * NOTE (quota): when this returns "salon" the salon pays Meta for its own
 * conversations, so any future per-message WhatsApp quota MUST NOT count or cap
 * these sends. There is no per-message counter today (waRemindersPerMonth is
 * marketing copy only, UsageCounter tracks bookings), so nothing to change yet —
 * but the branch to skip lives here via ResolvedSender.ownNumber.
 */
export function decideSender(args: {
  status: WhatsAppSenderStatus | null | undefined;
  planHasOwnNumber: boolean;
  hasSalonCreds: boolean;
}): "salon" | "platform" {
  if (!args.planHasOwnNumber) return "platform";
  if (args.status !== "ACTIVE") return "platform";
  if (!args.hasSalonCreds) return "platform";
  return "salon";
}

const platformSender = (): ResolvedSender => ({
  token: process.env.WHATSAPP_TOKEN || undefined,
  phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || undefined,
  ownNumber: false,
});

/**
 * Resolve the sending credentials for a salon. Never throws on the send path:
 * any problem (missing key, corrupt ciphertext, etc.) logs and falls back to the
 * platform number so a misconfigured own-number setup can never black-hole a
 * salon's notifications.
 */
export async function resolveWhatsAppSender(
  salonId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<ResolvedSender> {
  const sender = await db.whatsAppSender.findUnique({
    where: { salonId },
    select: {
      status: true,
      phoneNumberId: true,
      accessTokenEnc: true,
      salon: {
        select: {
          account: {
            select: {
              subscription: {
                select: {
                  plan: true,
                  status: true,
                  trialEndsAt: true,
                  currentPeriodEnd: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!sender) return platformSender();

  const sub = (sender.salon?.account.subscription ?? null) as SubscriptionLike | null;
  const planHasOwnNumber = featuresFor(effectivePlan(sub)).ownWhatsappNumber;
  const hasSalonCreds = !!sender.phoneNumberId && !!sender.accessTokenEnc;

  const decision = decideSender({ status: sender.status, planHasOwnNumber, hasSalonCreds });
  if (decision === "platform") return platformSender();

  try {
    const token = decryptSecret(sender.accessTokenEnc!);
    return { token, phoneNumberId: sender.phoneNumberId!, ownNumber: true };
  } catch (e) {
    console.error(
      `[whatsapp:sender] failed to decrypt own-number token for salon ${salonId} — ` +
        "falling back to the platform number",
      e,
    );
    return platformSender();
  }
}

/**
 * Map an inbound webhook's phone_number_id back to the salon that owns it, so
 * delivery-status callbacks can be scoped to that tenant. Returns null when the
 * id is the platform number (or unknown) — the caller then relies on the
 * globally-unique wamid alone.
 */
export async function salonForPhoneNumberId(
  phoneNumberId: string,
  db: Prisma.TransactionClient = prisma,
): Promise<string | null> {
  if (!phoneNumberId) return null;
  const row = await db.whatsAppSender.findFirst({
    where: { phoneNumberId, status: "ACTIVE" },
    select: { salonId: true },
  });
  return row?.salonId ?? null;
}

/**
 * Mask a display phone for owner-facing UI: keep the country/operator prefix and
 * the last two digits, hide the middle. "+994 50 123 45 67" → "+994 50 ••• •• 67".
 * Purely cosmetic — the real number/ids never leave the server anyway.
 */
export function maskPhone(displayPhone: string | null | undefined): string | null {
  if (!displayPhone) return null;
  const digits = displayPhone.replace(/\D/g, "");
  if (digits.length < 4) return displayPhone;
  const last2 = digits.slice(-2);
  // Country code (up to 3 digits) + operator (next up to 2), space-grouped, so
  // the output reads like a real number: "994501234567" -> "+994 50 ••• •• 67".
  const cc = digits.slice(0, 3);
  const op = digits.slice(3, Math.min(5, digits.length - 2));
  const prefix = op ? `${cc} ${op}` : cc;
  return `+${prefix} ••• •• ${last2}`;
}

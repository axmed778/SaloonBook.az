// Parsing of Meta's Instagram messaging webhook envelope.
//
// Kept apart from the route handler because it is the part worth testing: it is
// pure, it decides which events become database rows, and it is the only place
// that knows how `is_echo` inverts sender/recipient. The route stays a thin
// shell around it (read body, check HMAC, persist, 200).
//
// Everything here is defensive by design. Before the HMAC passes this is
// attacker-controlled input; after it passes it is Meta-controlled input, which
// gains new event types without notice. Neither is worth throwing over — an
// unrecognised shape is skipped and the delivery is still acknowledged.

import type { Prisma } from "@prisma/client";

// Typed as loosely as it actually arrives; every field is validated at use.
export interface IgMessagingEvent {
  sender?: { id?: unknown };
  recipient?: { id?: unknown };
  timestamp?: unknown;
  message?: {
    mid?: unknown;
    text?: unknown;
    is_echo?: unknown;
    attachments?: unknown;
  };
}

export interface IgEntry {
  time?: unknown;
  messaging?: unknown;
}

export interface ParsedIgEvent {
  /** The other party's IGSID — never our own IG_USER_ID. */
  igUserId: string;
  /** Instagram message id. Becomes the row's primary key. */
  mid: string;
  fromMe: boolean;
  text: string | null;
  attach: Prisma.InputJsonValue | null;
  sentAt: Date;
}

/**
 * Flatten a webhook body into the events worth storing, in arrival order.
 * Anything unrecognised is dropped rather than reported: see `parseIgEvent`.
 *
 * `self` is our own IGSID (IG_USER_ID). Passed in rather than read from the
 * environment so this stays pure and testable.
 */
export function parseIgWebhook(body: unknown, self: string | undefined): ParsedIgEvent[] {
  const out: ParsedIgEvent[] = [];
  for (const entry of asArray((body as { entry?: unknown } | null)?.entry) as IgEntry[]) {
    for (const ev of asArray(entry?.messaging) as IgMessagingEvent[]) {
      const parsed = parseIgEvent(ev, entry, self);
      if (parsed) out.push(parsed);
    }
  }
  return out;
}

/**
 * Narrow one raw messaging event to something storable, or null to skip it.
 *
 * Skips, and why each is a normal occurrence rather than an error:
 *   * no `message.mid` — reactions, read receipts, postbacks, typing indicators
 *                        and unsends all ride this envelope with no message.
 *   * no peer id       — malformed, or an event shape we do not model.
 *   * peer is us       — a message to our own account; storing it would create
 *                        a thread whose "lead" is the salon itself.
 */
export function parseIgEvent(
  ev: IgMessagingEvent | null | undefined,
  entry: IgEntry | undefined,
  self: string | undefined,
): ParsedIgEvent | null {
  const msg = ev?.message;
  if (!msg || typeof msg.mid !== "string" || msg.mid === "") return null;

  // is_echo marks our OWN outgoing message coming back to us — including
  // messages the salon typed in the Instagram app, which is what keeps the
  // stored thread complete. It also inverts the envelope: on an echo WE are the
  // sender, so the other party is the recipient.
  const fromMe = msg.is_echo === true;
  const peer = fromMe ? ev?.recipient?.id : ev?.sender?.id;
  if (typeof peer !== "string" || peer === "") return null;
  if (self && peer === self) return null;

  return {
    igUserId: peer,
    mid: msg.mid,
    fromMe,
    text: typeof msg.text === "string" ? msg.text : null,
    attach: isJsonish(msg.attachments) ? (msg.attachments as Prisma.InputJsonValue) : null,
    sentAt: igEventTime(ev?.timestamp, entry?.time),
  };
}

/**
 * Event timestamps arrive as epoch MILLISECONDS (unlike Graph's REST endpoints,
 * which return ISO strings). Falls back to the entry's own `time`, then to now:
 * a message with an unusable timestamp is still worth keeping, and `sentAt` is
 * NOT NULL.
 */
export function igEventTime(evTs: unknown, entryTs: unknown): Date {
  for (const raw of [evTs, entryTs]) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) continue;
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Only objects and arrays go into a Json column; scalars and null do not. */
function isJsonish(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}

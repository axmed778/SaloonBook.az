// Persistence for Instagram Direct conversations.
//
// One entry point — recordIgMessage — shared by the webhook (live events) and
// scripts/ig-backfill.ts (history import), so both write identical rows and a
// backfill that overlaps live traffic converges instead of duplicating.
//
// Idempotence is the whole design. Meta retries a webhook delivery until it
// gets a 200, the backfill can be re-run at will, and the two can race on the
// same message. Every write here is keyed so a repeat is a no-op:
//   * IgMessage.id  = the Instagram message id (mid)
//   * IgThread      = keyed by igUserId (unique)

import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/** Who sent the last message in a thread. Mirrored into IgThread.lastSender. */
export type IgSender = "ME" | "LEAD";

export interface IgIncomingMessage {
  /** The other party's Instagram-scoped id (never our own IG_USER_ID). */
  igUserId: string;
  /** Instagram message id. Doubles as the primary key, which is what dedupes. */
  mid: string;
  fromMe: boolean;
  text?: string | null;
  attach?: Prisma.InputJsonValue | null;
  sentAt: Date;
}

export interface IgRecordResult {
  threadId: string;
  /** False when this mid was already stored (a retry or a backfill overlap). */
  created: boolean;
}

/**
 * Ensures the thread for `igUserId` exists and returns its id.
 *
 * upsert is not atomic against a concurrent insert of the same igUserId — two
 * webhook deliveries for a brand-new conversation can both miss the row and
 * both try to create it, and the loser gets P2002 on the unique index. Meta
 * fans deliveries out in parallel, so this is a real race, not a theoretical
 * one: retry once and the second pass finds the row the winner wrote.
 */
async function ensureThread(igUserId: string): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const thread = await prisma.igThread.upsert({
        where: { igUserId },
        // Nothing to change here — lastMessageAt/lastSender are advanced
        // separately, under a monotonic guard (see below).
        update: {},
        create: { id: randomUUID(), igUserId },
        select: { id: true },
      });
      return thread.id;
    } catch (e) {
      const lost =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && attempt === 0;
      if (!lost) throw e;
    }
  }
  // Unreachable: the retry above either returns or rethrows. Kept so the
  // function has a total return type without an `as` cast.
  throw new Error("[ig] failed to create thread");
}

/**
 * Stores one Instagram Direct message and advances its thread's summary fields.
 *
 * Safe to call repeatedly with the same mid. Returns `created: false` when the
 * row was already there, which the callers use to keep their logs honest about
 * how much of a delivery was genuinely new.
 */
export async function recordIgMessage(msg: IgIncomingMessage): Promise<IgRecordResult> {
  const threadId = await ensureThread(msg.igUserId);

  // Existence check before the write so the caller can tell a fresh message
  // from a Meta retry. Racy in principle (two deliveries of the same mid could
  // both read "absent"), but the upsert below is the actual correctness
  // guarantee — the flag only feeds logging.
  const existing = await prisma.igMessage.findUnique({
    where: { id: msg.mid },
    select: { id: true },
  });

  await prisma.igMessage.upsert({
    where: { id: msg.mid },
    create: {
      id: msg.mid,
      threadId,
      fromMe: msg.fromMe,
      text: msg.text ?? null,
      attach: msg.attach ?? Prisma.DbNull,
      sentAt: msg.sentAt,
    },
    // A retry carries the same content, so this is normally a no-op write. It
    // is not `{}` on purpose: the backfill can see a message the webhook stored
    // from a partial event (attachment metadata arrives more completely on the
    // conversations endpoint), and letting the later read fill in the blanks is
    // strictly better than pinning whatever landed first.
    update: {
      text: msg.text ?? null,
      attach: msg.attach ?? Prisma.DbNull,
      sentAt: msg.sentAt,
    },
  });

  // Monotonic guard. Webhook deliveries arrive out of order and the backfill
  // walks history backwards, so an unconditional write would drag a thread's
  // lastMessageAt into the past and scramble the inbox ordering. updateMany
  // with the comparison in the WHERE makes it atomic: a stale event simply
  // matches zero rows.
  const sender: IgSender = msg.fromMe ? "ME" : "LEAD";
  await prisma.igThread.updateMany({
    where: {
      id: threadId,
      OR: [{ lastMessageAt: null }, { lastMessageAt: { lte: msg.sentAt } }],
    },
    data: { lastMessageAt: msg.sentAt, lastSender: sender },
  });

  return { threadId, created: existing === null };
}

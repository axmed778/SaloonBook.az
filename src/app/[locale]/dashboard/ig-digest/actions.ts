"use server";

import { z } from "zod";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// The Instagram digest is the platform's own sales pipeline — every lead who
// wrote to SalonBook's account — so it is gated by isPlatformAdmin, exactly
// like the admin panel, never by a salon role.

export type ActionResult = { ok: true } | { ok: false; error: string };

/** The acting platform admin's user id, or null for anyone else. */
async function requireAdmin(): Promise<string | null> {
  const session = await getSession();
  return session?.isAdmin ? session.user.id : null;
}

const doneSchema = z.object({
  digestId: z.string().min(1).max(64),
  index: z.number().int().min(0).max(10_000),
  // Must match the item at `index`: guards against toggling the wrong lead if
  // the array a stale tab was rendered from is not the one in the database.
  igUserId: z.string().min(1).max(64),
  done: z.boolean(),
});

/**
 * Tick or untick one digest item.
 *
 * A single jsonb_set rather than read-modify-write of the whole array: two
 * checkboxes clicked in quick succession would otherwise race, and the second
 * write would silently undo the first.
 */
export async function setIgDigestItemDone(input: unknown): Promise<ActionResult> {
  const adminId = await requireAdmin();
  const t = await getTranslations("IgDigest.errors");
  if (!adminId) return { ok: false, error: t("unauthorized") };
  const parsed = doneSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { digestId, index, igUserId, done } = parsed.data;

  const updated = await prisma.$executeRaw`
    UPDATE "IgDigest"
       SET items = jsonb_set(items, ${[String(index), "done"]}::text[], to_jsonb(${done}::boolean))
     WHERE id = ${digestId}
       AND items -> ${index}::int ->> 'igUserId' = ${igUserId}`;

  if (updated === 0) return { ok: false, error: t("notFound") };
  return { ok: true };
}

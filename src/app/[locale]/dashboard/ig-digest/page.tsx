import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatBakuDateTime } from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { isExcludedFromDigest, readDigestItems } from "@/lib/ig-digest";
import { IgDigestList, type ExcludedLead } from "./ig-digest-list";

export const dynamic = "force-dynamic";

// The founder's daily Instagram Direct digest: the newest IgDigest row, written
// every morning at 09:50 Baku by worker/processors/ig-digest.ts. Platform-admin
// only — these are SalonBook's own leads, not any salon's data.

export default async function IgDigestPage() {
  const session = (await getSession())!;
  if (!session.isAdmin) notFound();
  const t = await getTranslations("IgDigest");
  const df = intlLocale(await getLocale());

  const digest = await prisma.igDigest.findFirst({
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true, items: true },
  });
  const items = digest ? readDigestItems(digest.items) : [];
  const excluded = await loadExcludedLeads(df);

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {digest
            ? t("generatedAt", { when: formatBakuDateTime(digest.createdAt, df) })
            : t("subtitle")}
        </p>
      </header>

      <IgDigestList digestId={digest?.id ?? null} items={items} excluded={excluded} />
    </div>
  );
}

/**
 * Every lead currently excluded from the digest, newest exclusion first. A lead
 * who has written since is not on it: isExcludedFromDigest already counts them
 * back in, so listing them here would offer to "restore" a lead the digest is
 * showing again anyway.
 */
async function loadExcludedLeads(df: string): Promise<ExcludedLead[]> {
  const rows = await prisma.igThread.findMany({
    where: { digestExcludedAt: { not: null } },
    orderBy: { digestExcludedAt: "desc" },
    select: { id: true, igUserId: true, username: true, name: true, digestExcludedAt: true },
  });
  if (rows.length === 0) return [];

  const leadLast = await prisma.igMessage.groupBy({
    by: ["threadId"],
    where: { threadId: { in: rows.map((r) => r.id) }, fromMe: false },
    _max: { sentAt: true },
  });
  const leadLastAt = new Map(leadLast.map((g) => [g.threadId, g._max.sentAt]));

  return rows.flatMap((r) =>
    r.digestExcludedAt &&
    isExcludedFromDigest({
      digestExcludedAt: r.digestExcludedAt,
      lastLeadMessageAt: leadLastAt.get(r.id) ?? null,
    })
      ? [
          {
            igUserId: r.igUserId,
            username: r.username,
            name: r.name,
            when: formatBakuDateTime(r.digestExcludedAt, df),
          },
        ]
      : [],
  );
}

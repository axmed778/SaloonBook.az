import { notFound } from "next/navigation";
import { getTranslations, getLocale } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { formatBakuDateTime } from "@/lib/time";
import { intlLocale } from "@/i18n/format";
import { readDigestItems } from "@/lib/ig-digest";
import { IgDigestList } from "./ig-digest-list";

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

      {!digest ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("empty")}
        </p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
          {t("noTasks")}
        </p>
      ) : (
        <IgDigestList digestId={digest.id} items={items} />
      )}
    </div>
  );
}

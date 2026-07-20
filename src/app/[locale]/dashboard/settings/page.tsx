import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { parseBusinessHours } from "@/lib/business-hours";
import { SettingsManager, type BranchRow } from "./settings-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = (await getSession())!;
  const t = await getTranslations("Dashboard");
  if (!session.salonId) {
    return <p className="text-sm text-muted-foreground">{t("noSalonLinked")}</p>;
  }

  const salon = await prisma.salon.findUnique({
    where: { id: session.salonId },
    select: {
      name: true,
      description: true,
      address: true,
      phone: true,
      slug: true,
      businessHours: true,
    },
  });
  if (!salon) return <p className="text-sm text-muted-foreground">{t("noSalonTitle")}</p>;

  const appUrl = process.env.APP_URL || "http://localhost:3000";

  // Branch management (owners only): every non-deleted salon of the account,
  // oldest first — the oldest is the "primary" one carrying the public link.
  let branchRows: BranchRow[] = [];
  let linkSlug = salon.slug;
  if (session.role === "OWNER" && session.accountId) {
    const rows = await prisma.salon.findMany({
      where: { accountId: session.accountId, status: { not: "DELETED" } },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, address: true, status: true, slug: true },
    });
    branchRows = rows.map((r, i) => ({
      id: r.id,
      name: r.name,
      address: r.address,
      active: r.status === "ACTIVE",
      isPrimary: i === 0,
      isCurrent: r.id === session.salonId,
    }));
    // The advertised booking link is always the primary salon's slug, no matter
    // which branch the dashboard is currently switched to.
    if (rows.length > 0) linkSlug = rows[0].slug;
  }

  return (
    <SettingsManager
      salon={{
        name: salon.name,
        description: salon.description,
        address: salon.address,
        phone: salon.phone,
        slug: linkSlug,
        businessHours: parseBusinessHours(salon.businessHours),
      }}
      appUrl={appUrl}
      branchSection={
        session.role === "OWNER"
          ? {
              branches: branchRows,
              multiBranch: session.multiBranch,
              maxBranches: session.maxBranches,
            }
          : null
      }
    />
  );
}

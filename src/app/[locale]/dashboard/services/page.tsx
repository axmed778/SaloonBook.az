import { getTranslations } from "next-intl/server";
import { requireOwnerPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { ServicesManager } from "./services-manager";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const session = await requireOwnerPage();
  if (!session.salonId) {
    const t = await getTranslations("Dashboard");
    return <p className="text-sm text-muted-foreground">{t("noSalonLinked")}</p>;
  }

  const services = await prisma.service.findMany({
    where: { salonId: session.salonId },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      priceMinor: true,
      durationMin: true,
      bufferMin: true,
      isActive: true,
      audience: true,
      category: true,
    },
  });

  return <ServicesManager services={services} />;
}

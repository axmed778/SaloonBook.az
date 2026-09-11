import { getTranslations } from "next-intl/server";
import { requireOwnerPage } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { ServicesManager } from "./services-manager";
import { AddonsManager } from "./addons-manager";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const session = await requireOwnerPage();
  if (!session.salonId) {
    const t = await getTranslations("Dashboard");
    return <p className="text-sm text-muted-foreground">{t("noSalonLinked")}</p>;
  }

  const [services, addons] = await Promise.all([
    prisma.service.findMany({
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
    }),
    // Creation order, the same order customers see them in.
    prisma.serviceAddon.findMany({
      where: { salonId: session.salonId },
      orderBy: [{ isActive: "desc" }, { createdAt: "asc" }],
      select: {
        id: true,
        name: true,
        priceMinor: true,
        durationMin: true,
        isActive: true,
        services: { select: { serviceId: true } },
      },
    }),
  ]);

  const addonRows = addons.map((a) => ({
    id: a.id,
    name: a.name,
    priceMinor: a.priceMinor,
    durationMin: a.durationMin,
    isActive: a.isActive,
    serviceIds: a.services.map((l) => l.serviceId),
  }));

  return (
    <div className="space-y-10">
      <ServicesManager
        services={services.map((s) => ({
          ...s,
          // Which add-ons each service offers, so the link is visible from both
          // sides without opening the add-on form.
          addonNames: addonRows
            .filter((a) => a.isActive && a.serviceIds.includes(s.id))
            .map((a) => a.name),
        }))}
      />
      <AddonsManager
        addons={addonRows}
        services={services.map((s) => ({ id: s.id, name: s.name, isActive: s.isActive }))}
      />
    </div>
  );
}

import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { ServicesManager } from "./services-manager";

export const dynamic = "force-dynamic";

export default async function ServicesPage() {
  const session = (await getSession())!;
  if (!session.salonId) {
    const t = await getTranslations("Dashboard");
    return <p className="text-sm text-zinc-400">{t("noSalonLinked")}</p>;
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
    },
  });

  return <ServicesManager services={services} />;
}

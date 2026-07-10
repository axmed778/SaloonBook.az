import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { parseBusinessHours } from "@/lib/business-hours";
import { SettingsManager } from "./settings-manager";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = (await getSession())!;
  if (!session.salonId) {
    return <p className="text-sm text-zinc-400">Bu hesaba salon bağlanmayıb.</p>;
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
  if (!salon) return <p className="text-sm text-zinc-400">Salon tapılmadı.</p>;

  const appUrl = process.env.APP_URL || "http://localhost:3000";

  return (
    <SettingsManager
      salon={{
        name: salon.name,
        description: salon.description,
        address: salon.address,
        phone: salon.phone,
        slug: salon.slug,
        businessHours: parseBusinessHours(salon.businessHours),
      }}
      appUrl={appUrl}
    />
  );
}

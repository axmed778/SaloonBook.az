"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requireOwnerSalonId } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

// Server actions for the Services (Xidmətlər) screen. Every action re-derives
// the caller's salon from the session and scopes writes to it — a client can
// never touch another salon's services (defense in depth alongside RLS).

export type ActionResult = { ok: true } | { ok: false; error: string };


const serviceInput = z.object({
  name: z.string().trim().min(1, "Ad tələb olunur.").max(120),
  priceAzn: z.number().nonnegative("Qiymət mənfi ola bilməz.").max(100_000),
  durationMin: z.number().int().positive("Müddət 0-dan böyük olmalıdır.").max(1440),
  bufferMin: z.number().int().min(0).max(1440),
  audience: z.enum(["MALE", "FEMALE", "ALL"]),
  // Broad category for the public discovery-map filter.
  category: z
    .enum(["HAIR", "NAILS", "BROWS_LASHES", "MAKEUP", "SPA", "BARBER", "OTHER"])
    .default("OTHER"),
});

function toMinor(priceAzn: number): number {
  return Math.round(priceAzn * 100);
}

export async function createService(input: unknown): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Services.errors");
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const { name, priceAzn, durationMin, bufferMin, audience, category } = parsed.data;
  await prisma.service.create({
    data: {
      salonId,
      name,
      priceMinor: toMinor(priceAzn),
      durationMin,
      bufferMin,
      audience,
      category,
    },
  });
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function updateService(id: string, input: unknown): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Services.errors");
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const { name, priceAzn, durationMin, bufferMin, audience, category } = parsed.data;
  const res = await prisma.service.updateMany({
    where: { id, salonId }, // salonId in the filter = tenant guard
    data: { name, priceMinor: toMinor(priceAzn), durationMin, bufferMin, audience, category },
  });
  if (res.count === 0) return { ok: false, error: t("notFound") };
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function setServiceActive(id: string, isActive: boolean): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  await prisma.service.updateMany({ where: { id, salonId }, data: { isActive } });
  revalidatePath("/dashboard/services");
  return { ok: true };
}

// --- Add-ons ("French +5 ₼") ---------------------------------------------------
// Optional extras a customer adds to a main service while booking. Each is
// linked to the services it is offered with; the booking flow adds its price
// and minutes to the booking's (src/lib/addons.ts).

const addonInput = z.object({
  name: z.string().trim().min(1).max(120),
  priceAzn: z.number().nonnegative().max(100_000),
  durationMin: z.number().int().min(0).max(1440),
  // At least one: an add-on linked to nothing is offered nowhere, which is
  // never what the owner meant.
  serviceIds: z.array(z.string().uuid()).min(1).max(500),
});

/** True when every id is one of this salon's services. A link to anything
 *  else is refused outright, never silently dropped. */
async function ownsServices(salonId: string, ids: string[]): Promise<boolean> {
  const count = await prisma.service.count({ where: { id: { in: ids }, salonId } });
  return count === ids.length;
}

export async function createAddon(input: unknown): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Services.errors");
  const parsed = addonInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { name, priceAzn, durationMin } = parsed.data;
  const serviceIds = [...new Set(parsed.data.serviceIds)];
  if (!(await ownsServices(salonId, serviceIds))) return { ok: false, error: t("invalidData") };

  await prisma.$transaction(async (tx) => {
    const addon = await tx.serviceAddon.create({
      data: { salonId, name, priceMinor: toMinor(priceAzn), durationMin },
      select: { id: true },
    });
    await tx.serviceAddonLink.createMany({
      data: serviceIds.map((serviceId) => ({ serviceId, addonId: addon.id })),
    });
  });
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function updateAddon(id: string, input: unknown): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Services.errors");
  const parsed = addonInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const { name, priceAzn, durationMin } = parsed.data;
  const serviceIds = [...new Set(parsed.data.serviceIds)];
  if (!(await ownsServices(salonId, serviceIds))) return { ok: false, error: t("invalidData") };

  // Existing bookings keep their own copy (AppointmentAddon), so a new price or
  // length only applies from the next booking on.
  const found = await prisma.$transaction(async (tx) => {
    const res = await tx.serviceAddon.updateMany({
      where: { id, salonId }, // salonId in the filter = tenant guard
      data: { name, priceMinor: toMinor(priceAzn), durationMin },
    });
    if (res.count === 0) return false;
    await tx.serviceAddonLink.deleteMany({ where: { addonId: id } });
    await tx.serviceAddonLink.createMany({
      data: serviceIds.map((serviceId) => ({ serviceId, addonId: id })),
    });
    return true;
  });
  if (!found) return { ok: false, error: t("notFound") };
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function setAddonActive(id: string, isActive: boolean): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  await prisma.serviceAddon.updateMany({ where: { id, salonId }, data: { isActive } });
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function deleteAddon(id: string): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Services.errors");
  // Unlike a service, an add-on can always go: its links cascade, and the
  // bookings that used it keep their copy (AppointmentAddon.addonId → null).
  const res = await prisma.serviceAddon.deleteMany({ where: { id, salonId } });
  if (res.count === 0) return { ok: false, error: t("notFound") };
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function deleteService(id: string): Promise<ActionResult> {
  const salonId = await requireOwnerSalonId();
  const t = await getTranslations("Services.errors");
  try {
    const res = await prisma.service.deleteMany({ where: { id, salonId } });
    if (res.count === 0) return { ok: false, error: t("notFound") };
  } catch {
    // FK violation: appointments reference this service. Don't destroy history —
    // steer the owner to deactivate instead.
    return { ok: false, error: t("hasAppointments") };
  }
  revalidatePath("/dashboard/services");
  return { ok: true };
}

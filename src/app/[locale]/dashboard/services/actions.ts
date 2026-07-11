"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// Server actions for the Services (Xidmətlər) screen. Every action re-derives
// the caller's salon from the session and scopes writes to it — a client can
// never touch another salon's services (defense in depth alongside RLS).

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSalonId(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  return session.salonId;
}

const serviceInput = z.object({
  name: z.string().trim().min(1, "Ad tələb olunur.").max(120),
  priceAzn: z.number().nonnegative("Qiymət mənfi ola bilməz.").max(100_000),
  durationMin: z.number().int().positive("Müddət 0-dan böyük olmalıdır.").max(1440),
  bufferMin: z.number().int().min(0).max(1440),
  audience: z.enum(["MALE", "FEMALE", "ALL"]),
});

function toMinor(priceAzn: number): number {
  return Math.round(priceAzn * 100);
}

export async function createService(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Services.errors");
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const { name, priceAzn, durationMin, bufferMin, audience } = parsed.data;
  await prisma.service.create({
    data: { salonId, name, priceMinor: toMinor(priceAzn), durationMin, bufferMin, audience },
  });
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function updateService(id: string, input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Services.errors");
  const parsed = serviceInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const { name, priceAzn, durationMin, bufferMin, audience } = parsed.data;
  const res = await prisma.service.updateMany({
    where: { id, salonId }, // salonId in the filter = tenant guard
    data: { name, priceMinor: toMinor(priceAzn), durationMin, bufferMin, audience },
  });
  if (res.count === 0) return { ok: false, error: t("notFound") };
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function setServiceActive(id: string, isActive: boolean): Promise<ActionResult> {
  const salonId = await requireSalonId();
  await prisma.service.updateMany({ where: { id, salonId }, data: { isActive } });
  revalidatePath("/dashboard/services");
  return { ok: true };
}

export async function deleteService(id: string): Promise<ActionResult> {
  const salonId = await requireSalonId();
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

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";

// Server actions for the Settings (Tənzimləmələr) screen. Each action derives the
// caller's salon from the session and only ever writes to that salon.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSalonId(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  return session.salonId;
}

// --- Profile ---------------------------------------------------------------

const profileSchema = z.object({
  name: z.string().trim().min(2, "Salon adı ən az 2 simvol olmalıdır.").max(120),
  description: z.string().trim().max(1000).nullish(),
  address: z.string().trim().max(300).nullish(),
  phone: z.string().trim().max(32).nullish(),
});

export async function updateProfile(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Yanlış məlumat." };
  }
  const d = parsed.data;
  await prisma.salon.update({
    where: { id: salonId },
    data: {
      name: d.name,
      description: d.description || null,
      address: d.address || null,
      phone: d.phone || null,
    },
  });
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");
  return { ok: true };
}

// --- Booking link (slug) ---------------------------------------------------

function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

const slugSchema = z.object({ slug: z.string().trim().min(1).max(60) });

export async function updateSlug(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const parsed = slugSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Yanlış link." };

  const slug = slugify(parsed.data.slug);
  if (slug.length < 2) {
    return { ok: false, error: "Link ən az 2 hərf və ya rəqəmdən ibarət olmalıdır." };
  }

  const existing = await prisma.salon.findUnique({ where: { slug }, select: { id: true } });
  if (existing && existing.id !== salonId) {
    return { ok: false, error: "Bu link artıq istifadə olunur. Başqasını seçin." };
  }

  await prisma.salon.update({ where: { id: salonId }, data: { slug } });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

// --- Business hours --------------------------------------------------------

const hourSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    openMin: z.number().int().min(0).max(1440),
    closeMin: z.number().int().min(0).max(1440),
  })
  .refine((h) => h.closeMin > h.openMin, {
    message: "Bağlanma vaxtı açılışdan sonra olmalıdır.",
  });

const businessHoursSchema = z
  .array(hourSchema)
  .max(7)
  .superRefine((arr, ctx) => {
    const seen = new Set<number>();
    for (const h of arr) {
      if (seen.has(h.weekday)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Hər gün üçün yalnız bir interval.",
        });
        return;
      }
      seen.add(h.weekday);
    }
  });

export async function updateBusinessHours(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const parsed = businessHoursSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Yanlış saatlar." };
  }
  await prisma.salon.update({
    where: { id: salonId },
    data: { businessHours: parsed.data },
  });
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

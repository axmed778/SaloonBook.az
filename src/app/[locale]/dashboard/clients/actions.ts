"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { bakuPeriodYm } from "@/lib/time";

// Server actions for the Clients CRM. Same tenancy rules as every dashboard
// action: salonId is re-derived from the session and used as a write guard in
// each where-filter, so a crafted id can never touch another salon's customer.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requireSalonId(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  return session.salonId;
}

function revalidateClients(customerId?: string) {
  revalidatePath("/dashboard/clients");
  if (customerId) revalidatePath(`/dashboard/clients/${customerId}`);
}

// --- Edit customer -----------------------------------------------------------

const customerSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Ad tələb olunur.")
    .max(120)
    .regex(/[\p{L}\p{N}]/u, "Ad hərf və ya rəqəm daxil etməlidir."),
  phone: z
    .string()
    .regex(/^\+994\d{9}$/, "Telefon +994XXXXXXXXX formatında olmalıdır."),
});

export async function updateCustomer(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Clients.errors");
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("invalidData") };
  }
  const d = parsed.data;

  try {
    const res = await prisma.customer.updateMany({
      where: { id: d.id, salonId },
      data: { name: d.name, phone: d.phone },
    });
    if (res.count === 0) return { ok: false, error: t("notFound") };
  } catch (e) {
    // @@unique([salonId, phone]) — the number already belongs to another customer.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: t("phoneTaken") };
    }
    console.error("[clients] updateCustomer error", e);
    return { ok: false, error: t("saveFailed") };
  }

  revalidateClients(d.id);
  return { ok: true };
}

// --- Notes --------------------------------------------------------------------

const noteSchema = z.object({
  customerId: z.string().uuid(),
  body: z.string().trim().min(1, "Qeyd boş ola bilməz.").max(1000),
});

export async function addCustomerNote(input: unknown): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Clients.errors");
  const parsed = noteSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: t("noteEmpty") };
  }
  const d = parsed.data;

  // Tenant guard: the customer must belong to this salon.
  const customer = await prisma.customer.findFirst({
    where: { id: d.customerId, salonId },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: t("notFound") };

  await prisma.customerNote.create({
    data: { salonId, customerId: d.customerId, body: d.body },
  });

  revalidateClients(d.customerId);
  return { ok: true };
}

export async function deleteCustomerNote(id: string): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Clients.errors");
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: t("invalidData") };

  const res = await prisma.customerNote.deleteMany({ where: { id, salonId } });
  if (res.count === 0) return { ok: false, error: t("noteNotFound") };

  revalidateClients();
  return { ok: true };
}

// --- Delete customer -----------------------------------------------------------

/**
 * Deletes the customer AND their entire history (appointments, their queued
 * notifications, CRM notes) in one transaction. The profile UI shows exactly
 * what will be removed and requires explicit confirmation — this is the
 * owner's data to destroy. Analytics derived from appointments will no longer
 * include this customer afterwards.
 *
 * Guard: deletion is refused when the customer has COMPLETED appointments in a
 * month that already has a recorded payout for that employee. Those months are
 * financially settled — removing the appointments would retroactively lower a
 * commission that was already paid out.
 */
export async function deleteCustomer(id: string): Promise<ActionResult> {
  const salonId = await requireSalonId();
  const t = await getTranslations("Clients.errors");
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: t("invalidData") };

  const customer = await prisma.customer.findFirst({
    where: { id, salonId },
    select: { id: true },
  });
  if (!customer) return { ok: false, error: t("notFound") };

  // Block if any COMPLETED appointment falls in an already-settled (paid-out)
  // employee-month.
  const completed = await prisma.appointment.findMany({
    where: { salonId, customerId: id, status: "COMPLETED" },
    select: { employeeId: true, startsAt: true },
  });
  if (completed.length > 0) {
    const settledKeys = new Set(
      completed.map((a) => `${a.employeeId}|${bakuPeriodYm(a.startsAt)}`),
    );
    const payouts = await prisma.payout.findMany({
      where: {
        salonId,
        employeeId: { in: [...new Set(completed.map((a) => a.employeeId))] },
        periodYm: { in: [...new Set(completed.map((a) => bakuPeriodYm(a.startsAt)))] },
      },
      select: { employeeId: true, periodYm: true },
    });
    const isSettled = payouts.some((p) => settledKeys.has(`${p.employeeId}|${p.periodYm}`));
    if (isSettled) {
      return { ok: false, error: t("deleteSettled") };
    }
  }

  await prisma.$transaction([
    prisma.notification.deleteMany({
      where: { salonId, appointment: { customerId: id } },
    }),
    prisma.appointment.deleteMany({ where: { salonId, customerId: id } }),
    prisma.customerNote.deleteMany({ where: { salonId, customerId: id } }),
    prisma.customer.deleteMany({ where: { salonId, id } }),
  ]);

  revalidateClients();
  revalidatePath("/dashboard"); // calendar may have shown their appointments
  return { ok: true };
}

"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { featuresFor } from "@/lib/plans";
import { effectivePlan, subscriptionForSalon } from "@/lib/subscription";

// Server actions for the PRO payroll screen. Same tenancy rules as the other
// dashboard actions (salonId re-derived from the session, used as a write
// guard), plus a plan gate: payroll is a Pro feature, enforced server-side so
// a downgraded account can't keep using it through stale UI.

export type ActionResult = { ok: true } | { ok: false; error: string };

async function requirePayrollSalon(): Promise<string> {
  const session = await getSession();
  if (!session?.salonId) throw new Error("Unauthorized: no salon in session");
  const sub = await subscriptionForSalon(prisma, session.salonId);
  if (!featuresFor(effectivePlan(sub)).payroll) {
    throw new Error("Əməkhaqqı modulu Pro planın funksiyasıdır.");
  }
  return session.salonId;
}

// 100 000 AZN in qəpik — sanity ceiling for salaries and payouts.
const MAX_MINOR = 10_000_000;

const paySchema = z.object({
  employeeId: z.string().uuid(),
  baseSalaryMinor: z.number().int().min(0).max(MAX_MINOR),
  commissionPct: z.number().int().min(0).max(100),
});

export async function saveEmployeePay(input: unknown): Promise<ActionResult> {
  let salonId: string;
  try {
    salonId = await requirePayrollSalon();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "İcazə yoxdur." };
  }
  const parsed = paySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Yanlış məlumat." };
  const d = parsed.data;

  const res = await prisma.employee.updateMany({
    where: { id: d.employeeId, salonId },
    data: { baseSalaryMinor: d.baseSalaryMinor, commissionPct: d.commissionPct },
  });
  if (res.count === 0) return { ok: false, error: "İşçi tapılmadı." };

  revalidatePath("/dashboard/payroll");
  return { ok: true };
}

const payoutSchema = z.object({
  employeeId: z.string().uuid(),
  periodYm: z.string().regex(/^\d{4}-\d{2}$/),
  amountMinor: z.number().int().min(1).max(MAX_MINOR),
  note: z.string().trim().max(300).nullish(),
});

export async function recordPayout(input: unknown): Promise<ActionResult> {
  let salonId: string;
  try {
    salonId = await requirePayrollSalon();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "İcazə yoxdur." };
  }
  const parsed = payoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Yanlış məlumat." };
  const d = parsed.data;

  // Tenant guard: the employee must belong to this salon.
  const employee = await prisma.employee.findFirst({
    where: { id: d.employeeId, salonId },
    select: { id: true },
  });
  if (!employee) return { ok: false, error: "İşçi tapılmadı." };

  await prisma.payout.create({
    data: {
      salonId,
      employeeId: d.employeeId,
      periodYm: d.periodYm,
      amountMinor: d.amountMinor,
      note: d.note || null,
    },
  });

  revalidatePath("/dashboard/payroll");
  return { ok: true };
}

export async function deletePayout(id: string): Promise<ActionResult> {
  let salonId: string;
  try {
    salonId = await requirePayrollSalon();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "İcazə yoxdur." };
  }
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Yanlış məlumat." };

  const res = await prisma.payout.deleteMany({ where: { id, salonId } });
  if (res.count === 0) return { ok: false, error: "Ödəniş tapılmadı." };

  revalidatePath("/dashboard/payroll");
  return { ok: true };
}

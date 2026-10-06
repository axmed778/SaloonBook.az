"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";
import { markLinkCopied } from "./guides";
import { updateProfile } from "../settings/actions";
import { createService } from "../services/actions";
import { saveEmployee } from "../workers/actions";

// The writes behind the mandatory setup gate (src/components/onboarding/setup-gate.tsx).
//
// Each step asks for the least it can — a phone and an address, one service,
// one master, one week of hours — and each one DELEGATES to the action the
// matching screen already uses, so a rule only lives in one place: the seat
// limit, the overlapping-hours check, the slug, the revalidations. What is here
// is the small translation from "the gate's step" to "that screen's payload".
//
// Every action opens with its own guard anyway (guard-coverage.test.ts holds
// them to it): the gate is a dialog, and a dialog protects nothing.

export type ActionResult = { ok: true } | { ok: false; error: string };

// --- Step 1: the salon's details -------------------------------------------

const profileStep = z.object({
  phone: z.string().trim().min(5).max(32),
  address: z.string().trim().min(3).max(300),
});

/** Phone and address — what a client needs to find and call the salon. */
export async function saveSetupProfile(input: unknown): Promise<ActionResult> {
  const { salonId } = await requirePermission("settings.write");
  const t = await getTranslations("Settings.errors");
  const parsed = profileStep.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  // The Settings form saves the whole profile at once, so the salon's current
  // name and description go back untouched with the two new fields.
  const salon = await prisma.salon.findUnique({
    where: { id: salonId },
    select: { name: true, description: true, district: true },
  });
  if (!salon) return { ok: false, error: t("invalidData") };

  return updateProfile({
    name: salon.name,
    description: salon.description,
    district: salon.district,
    phone: parsed.data.phone,
    address: parsed.data.address,
  });
}

// --- Step 2: the first service ---------------------------------------------

const serviceStep = z.object({
  name: z.string().trim().min(1).max(120),
  priceAzn: z.number().nonnegative().max(100_000),
  durationMin: z.number().int().positive().max(1440),
});

/** One service, with the defaults the Services screen would have offered. */
export async function saveSetupService(input: unknown): Promise<ActionResult> {
  await requirePermission("services.write");
  const t = await getTranslations("Services.errors");
  const parsed = serviceStep.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  return createService({
    name: parsed.data.name,
    priceAzn: parsed.data.priceAzn,
    durationMin: parsed.data.durationMin,
    bufferMin: 0,
    audience: "ALL",
    category: "OTHER",
  });
}

// --- Step 3: the first master ----------------------------------------------

const masterStep = z.object({ name: z.string().trim().min(1).max(120) });

/**
 * One active master, able to do every service the salon has — which is what a
 * salon with one service and one chair means, and what makes the public page
 * offer slots at all. saveEmployee() takes the seat limit for us.
 */
export async function saveSetupMaster(input: unknown): Promise<ActionResult> {
  const { salonId } = await requirePermission("staff.manage");
  const t = await getTranslations("Workers.errors");
  const parsed = masterStep.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };

  const services = await prisma.service.findMany({
    where: { salonId, isActive: true },
    select: { id: true },
  });
  return saveEmployee({
    name: parsed.data.name,
    position: null,
    phone: null,
    isActive: true,
    audience: "ALL",
    serviceIds: services.map((s) => s.id),
    hours: [],
  });
}

// --- Step 4: the working week ----------------------------------------------

const hoursStep = z.object({
  employeeId: z.string().uuid(),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
});

/**
 * One window a day, the same on every day the salon works — the shape a small
 * salon's week actually has. Breaks and per-day differences are the Workers
 * screen's job; this only has to produce a week that offers slots.
 */
export async function saveSetupHours(input: unknown): Promise<ActionResult> {
  const { salonId } = await requirePermission("staff.manage");
  const t = await getTranslations("Workers.errors");
  const parsed = hoursStep.safeParse(input);
  if (!parsed.success) return { ok: false, error: t("invalidData") };
  const d = parsed.data;
  if (d.endMin <= d.startMin) return { ok: false, error: t("invalidData") };

  // salonId in the filter is the tenant guard: an id from another salon is a
  // "not found", not someone else's employee rewritten.
  const employee = await prisma.employee.findFirst({
    where: { id: d.employeeId, salonId },
    select: {
      id: true,
      name: true,
      position: true,
      phone: true,
      audience: true,
      services: { select: { serviceId: true } },
    },
  });
  if (!employee) return { ok: false, error: t("notFound") };

  return saveEmployee({
    id: employee.id,
    name: employee.name,
    position: employee.position,
    phone: employee.phone,
    isActive: true,
    audience: employee.audience,
    serviceIds: employee.services.map((s) => s.serviceId),
    hours: [...new Set(d.weekdays)].map((weekday) => ({
      weekday,
      startMin: d.startMin,
      endMin: d.endMin,
    })),
  });
}

// --- Step 5: the link ------------------------------------------------------

/**
 * The booking link was copied — the last step, and the gate's end. It also
 * closes the welcome dialog for good: the gate just walked the person through
 * everything the welcome was there to announce, so showing it afterwards would
 * invite them to start what they have finished.
 */
export async function finishSetup(): Promise<ActionResult> {
  const session = await requirePermission("settings.write");
  await markLinkCopied();
  await prisma.userGuideState.upsert({
    where: { userId: session.user.id },
    create: { userId: session.user.id, welcomeShownAt: new Date() },
    update: { welcomeShownAt: new Date() },
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

import { expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Registering a brand-new salon and walking it through the mandatory setup
// gate — the two things every first-run spec needs before it can look at the
// dashboard behind them. Shared so a copy edit in messages/az.json, or a sixth
// step in the gate, is one change here rather than one per spec.

type Catalog = {
  Auth: {
    emailLabel: string;
    register: { salonName: string; staffCount: string; submit: string };
  };
  Weekdays: Record<string, string>;
  Onboarding: {
    gate: {
      next: string;
      finish: string;
      weekdayShort: Record<string, string>;
      steps: Record<string, { title: string; why: string }>;
      fields: Record<string, string>;
    };
  };
};

export const catalog = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as Catalog;

const gateCopy = catalog.Onboarding.gate;

/** The gate's panel on a given step, by the step it is on. */
export const gateStep = (page: Page, step: string) =>
  page.locator(`[data-setup-step="${step}"]`);

/** No gate on screen at all — the dashboard behind it is usable. */
export const noGate = (page: Page) => page.locator("[data-setup-step]");

/**
 * Register a fresh salon (a unique email, harmless on a seeded test database)
 * and land on the dashboard. `staffCount` is the answer the trial tier is
 * picked from.
 */
export async function registerSalon(
  page: Page,
  label: string,
  staffCount = 1,
): Promise<{ email: string; salonName: string }> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  const email = `e2e-${label}-${stamp}@example.com`;
  const salonName = `E2E ${label} ${stamp}`;
  await page.goto("/register");
  await page.getByLabel(catalog.Auth.register.salonName, { exact: true }).fill(salonName);
  await page.getByLabel(catalog.Auth.register.staffCount, { exact: true }).fill(String(staffCount));
  await page.getByLabel(catalog.Auth.emailLabel, { exact: true }).fill(email);
  for (const field of await page.locator('input[autocomplete="new-password"]').all()) {
    await field.fill("Onb0arding!x");
  }
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: catalog.Auth.register.submit, exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
  return { email, salonName };
}

/**
 * Walk the five mandatory steps, filling each one in where it is shown. Leaves
 * the gate gone and the dashboard on screen.
 */
export async function walkSetupGate(page: Page): Promise<void> {
  const next = (step: string) =>
    gateStep(page, step).getByRole("button", { name: gateCopy.next, exact: true });

  // 1 — the salon's details.
  await expect(gateStep(page, "profile")).toBeVisible();
  await page.getByLabel(gateCopy.fields.phone, { exact: true }).fill("+994501112233");
  await page.getByLabel(gateCopy.fields.address, { exact: true }).fill("Nizami küç. 1");
  await next("profile").click();

  // 2 — the first service.
  await expect(gateStep(page, "service")).toBeVisible();
  await page.getByLabel(gateCopy.fields.serviceName, { exact: true }).fill("Saç kəsimi");
  await page.getByLabel(gateCopy.fields.price, { exact: true }).fill("20");
  await next("service").click();

  // 3 — the first master.
  await expect(gateStep(page, "master")).toBeVisible();
  await page.getByLabel(gateCopy.fields.masterName, { exact: true }).fill("Aysel");
  await next("master").click();

  // 4 — the working week, as the gate offers it (Mon–Sat, 10:00–19:00).
  await expect(gateStep(page, "hours")).toBeVisible();
  await next("hours").click();

  // 5 — the link, which also ends the gate.
  await expect(gateStep(page, "link")).toBeVisible();
  await gateStep(page, "link")
    .getByRole("button", { name: gateCopy.fields.copy, exact: true })
    .click();
  await gateStep(page, "link")
    .getByRole("button", { name: gateCopy.finish, exact: true })
    .click();
  await expect(noGate(page)).toHaveCount(0);
}

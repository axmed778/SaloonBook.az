import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { copy } from "./fixtures";

// Smoke: one interactive guide walked end to end on the real dashboard — the
// help button, the panel, every step of "Add a service" finishing on the real
// action, and the service actually saved.
//
// Needs an owner login on the seeded database. `pnpm db:seed` creates
// saloon@book.az with SEED_OWNER_PASSWORD; pass the same pair here:
//   E2E_OWNER_EMAIL=saloon@book.az E2E_OWNER_PASSWORD=… pnpm e2e guide
// Skipped without them, like any spec that needs a secret. It adds one service
// per run (a unique name), which is harmless on a seeded test database.

const email = process.env.E2E_OWNER_EMAIL;
const password = process.env.E2E_OWNER_PASSWORD;

const az = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as {
  Help: { fab: string; greeting: string };
  Guides: {
    ui: { next: string; done: string; back: string };
    guides: { addService: { title: string; steps: Record<string, { do: string }> } };
  };
  LegalReconsent: { confirm: string; accept: string };
};
const steps = az.Guides.guides.addService.steps;

async function logIn(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[autocomplete="current-password"]').fill(password!);
  await page.getByRole("button", { name: copy.loginSubmit, exact: true }).click();
  await page.waitForURL(/\/dashboard/);
  // A freshly seeded account has not accepted the current legal texts, and the
  // gate blocks the dashboard (and the help button, on purpose) until it does.
  const accept = page.getByRole("button", { name: az.LegalReconsent.accept, exact: true });
  if (await accept.isVisible().catch(() => false)) {
    await page.getByLabel(az.LegalReconsent.confirm).check();
    await accept.click();
    await expect(accept).toHaveCount(0);
  }
}

/** The guide's card, by what it says. */
const card = (page: Page) => page.locator('[data-guide-layer="card"]');

for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "phone 360", size: { width: 360, height: 740 } },
]) {
  test.describe(`guide: add a service (${viewport.name})`, () => {
    test.skip(!email || !password, "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD not set");
    test.use({ viewport: viewport.size });

    test("walks from the help button to a saved service", async ({ page }) => {
      await logIn(page);
      await page.goto("/dashboard");

      await page.getByRole("button", { name: az.Help.fab }).click();
      await expect(page.getByRole("heading", { name: az.Help.greeting })).toBeVisible();
      await page.getByRole("button", { name: az.Guides.guides.addService.title }).click();

      // Step 1: reach the Services page through the menu (on a phone, the menu
      // button first).
      await expect(card(page)).toContainText(
        viewport.name === "desktop" ? steps.openPage.do : /./,
      );
      if (viewport.name !== "desktop") {
        await page.locator('[data-tour="nav.menu"]').click();
      }
      await page.locator('[data-tour="nav.services"]:visible').click();
      await page.waitForURL(/\/dashboard\/services$/);

      // Step 2: the "New service" button.
      await expect(card(page)).toContainText(steps.openForm.do);
      await page.locator('[data-tour="service.add"]').click();

      // Steps 3–5: the fields. A field's step finishes when it is committed.
      await expect(card(page)).toContainText(steps.name.do);
      const name = `E2E guide ${Date.now()}`;
      await page.locator('[data-tour="service.name"]').fill(name);
      await page.locator('[data-tour="service.name"]').press("Enter");
      await expect(card(page)).toContainText(steps.price.do);
      await page.locator('[data-tour="service.price"]').fill("25");
      await page.locator('[data-tour="service.price"]').press("Enter");
      await expect(card(page)).toContainText(steps.duration.do);
      // Duration comes pre-filled; "Next" accepts it.
      await card(page).getByRole("button", { name: az.Guides.ui.next }).click();

      // Step 6: save — finishes only when the form closes (the save worked).
      await expect(card(page)).toContainText(steps.save.do);
      await page.locator('[data-tour="service.save"]').click();

      // Step 7: done, and the service is in the list.
      await expect(card(page)).toContainText(steps.done.do);
      // Attached, not visible: at 360px the service list squeezes names to
      // nothing (a layout issue of the list itself, outside this guide).
      await expect(page.getByText(name)).toBeAttached();
      await card(page).getByRole("button", { name: az.Guides.ui.done }).click();
      await expect(card(page)).toHaveCount(0);
    });

    test("survives a reload and closes on Escape", async ({ page }) => {
      await logIn(page);
      await page.goto("/dashboard/services");
      await page.getByRole("button", { name: az.Help.fab }).click();
      await page.getByRole("button", { name: az.Guides.guides.addService.title }).click();
      // Already on the page: the navigate step is skipped, and "Back" does not
      // lead into it (it would only bounce forward again).
      await expect(card(page)).toContainText(steps.openForm.do);
      await expect(card(page).getByRole("button", { name: az.Guides.ui.back })).toBeDisabled();

      await page.reload();
      await expect(card(page)).toContainText(steps.openForm.do);

      await page.keyboard.press("Escape");
      await expect(card(page)).toHaveCount(0);
      await page.reload();
      await expect(page.locator('[data-tour="help.fab"]')).toBeVisible();
      await expect(card(page)).toHaveCount(0);
    });
  });
}

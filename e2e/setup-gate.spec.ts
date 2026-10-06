import { test, expect } from "@playwright/test";
import { catalog, gateStep, noGate, registerSalon, walkSetupGate } from "./setup-flow";

// Smoke: the mandatory setup gate a salon meets the moment it signs up — it is
// on screen, it explains the step, it cannot be walked around, every step is
// filled in where it is shown, and once it is done it stays done.
//
// Registers a fresh account per run (a unique email), which is harmless on a
// seeded test database.

const gate = catalog.Onboarding.gate;

for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "phone 360", size: { width: 360, height: 740 } },
]) {
  test.describe(`setup gate (${viewport.name})`, () => {
    test.use({ viewport: viewport.size });

    test("leads the salon through every required step and then gets out of the way", async ({
      page,
    }) => {
      await registerSalon(page, "gate", 5);

      // It is the first thing on screen, and it says why this step matters —
      // nothing to find in a menu.
      const first = gateStep(page, "profile");
      await expect(first).toBeVisible();
      await expect(first).toContainText(gate.steps.profile.title);
      await expect(first).toContainText(gate.steps.profile.why);

      // Mandatory: no close button, Escape does nothing, and another dashboard
      // route is no way around it.
      await expect(first.getByRole("button", { name: gate.next, exact: true })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(gateStep(page, "profile")).toBeVisible();
      await page.goto("/dashboard/calendar");
      await expect(gateStep(page, "profile")).toBeVisible();

      await walkSetupGate(page);

      // Gone, and it stays gone: the salon's own rows answer every step now.
      await page.reload();
      await expect(noGate(page)).toHaveCount(0);
      await expect(page.locator('[data-tour="help.fab"]')).toBeVisible();
    });

    test("a step filled in before the gate asks is not asked again", async ({ page }) => {
      await registerSalon(page, "gate-skip", 1);

      // Answer step 1 and reload: the gate opens on step 2, not back at the top.
      await page.getByLabel(gate.fields.phone, { exact: true }).fill("+994501112233");
      await page.getByLabel(gate.fields.address, { exact: true }).fill("Nizami küç. 1");
      await gateStep(page, "profile")
        .getByRole("button", { name: gate.next, exact: true })
        .click();
      await expect(gateStep(page, "service")).toBeVisible();
      await page.reload();
      await expect(gateStep(page, "service")).toBeVisible();
    });
  });
}

import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { copy } from "./fixtures";
import { registerSalon, walkSetupGate } from "./setup-flow";

// Smoke: what a salon sees on Today once it is through the mandatory setup gate
// (e2e/setup-gate.spec.ts walks the gate itself) — the checklist ticked by the
// real data the gate saved, the one step it leaves open, hiding the list and
// getting it back from the help panel — and the other half of the rule: an
// account from before the first-run flow never sees the welcome.
//
// Registers a fresh account per run (a unique email), which is harmless on a
// seeded test database. The existing-account test needs the seeded owner:
//   E2E_OWNER_EMAIL=saloon@book.az E2E_OWNER_PASSWORD=… pnpm e2e onboarding

const az = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as {
  LegalReconsent: { confirm: string; accept: string };
  Help: { fab: string; setup: { title: string } };
  Onboarding: {
    welcome: { title: string };
    checklist: {
      title: string;
      progress: string;
      hide: string;
      hiddenNote: string;
      items: Record<string, { title: string }>;
    };
  };
};
const ob = az.Onboarding;
const progress = (done: number) =>
  ob.checklist.progress.replace("{done}", String(done)).replace("{total}", "6");

const checklist = (page: Page) => page.locator('[data-tour="today.checklist"]');

for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "phone 360", size: { width: 360, height: 740 } },
]) {
  test.describe(`first run (${viewport.name})`, () => {
    test.use({ viewport: viewport.size });

    test("the checklist carries on where the gate left off, and hides and comes back", async ({
      page,
    }) => {
      await registerSalon(page, "onboarding", 2);
      await walkSetupGate(page);

      // The gate did five of the six steps, so the checklist opens on the one
      // it leaves optional — the test booking — ticked by the data, not by the
      // gate saying so.
      await expect(checklist(page)).toBeVisible();
      await expect(checklist(page)).toContainText(progress(5));
      await expect(checklist(page)).toContainText(ob.checklist.items.booking.title);

      // And the welcome does not follow the gate: it would invite the person to
      // start what they have just finished.
      await expect(page.getByRole("dialog", { name: ob.welcome.title })).toHaveCount(0);

      // Hide: it says where it went, stays hidden on reload, and comes back
      // from the help panel.
      // Wait for the save itself before reloading: the reload must test what
      // the server stored, not race the request.
      const saved = () =>
        page.waitForResponse((r) => r.request().method() === "POST" && !!r.request().headers()["next-action"]);
      let save = saved();
      await checklist(page).getByRole("button", { name: ob.checklist.hide }).click();
      await expect(page.getByText(ob.checklist.hiddenNote)).toBeVisible();
      await save;
      await page.reload();
      await expect(checklist(page)).toHaveCount(0);

      await page.getByRole("button", { name: az.Help.fab }).click();
      save = saved();
      await page.getByRole("button", { name: new RegExp(az.Help.setup.title) }).click();
      await expect(checklist(page)).toBeVisible();
      await save;
      await page.reload();
      await expect(checklist(page)).toBeVisible();
    });
  });
}

test.describe("an account from before the first-run flow", () => {
  const email = process.env.E2E_OWNER_EMAIL;
  const password = process.env.E2E_OWNER_PASSWORD;
  test.skip(!email || !password, "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD not set");

  test("never sees the welcome", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill(email!);
    await page.locator('input[autocomplete="current-password"]').fill(password!);
    await page.getByRole("button", { name: copy.loginSubmit, exact: true }).click();
    await page.waitForURL(/\/dashboard/);
    // The seeded account may owe an acceptance of revised legal texts first.
    const accept = page.getByRole("button", { name: az.LegalReconsent.accept, exact: true });
    if (await accept.isVisible().catch(() => false)) {
      await page.getByLabel(az.LegalReconsent.confirm).check();
      await accept.click();
      await expect(accept).toHaveCount(0);
    }
    await page.goto("/dashboard");
    await expect(page.locator('[data-tour="help.fab"]')).toBeVisible();
    await expect(page.getByRole("dialog", { name: ob.welcome.title })).toHaveCount(0);
  });
});

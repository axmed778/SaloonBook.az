import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { copy } from "./fixtures";

// Smoke: the first-run flow of a salon that signs up today — the welcome, the
// checklist on Today ticked by real data, a "Show me how" guide finishing an
// item, hiding the list and getting it back from the help panel — and the
// other half of the rule: an account from before it never sees the welcome.
//
// Registers a fresh account per run (a unique email), which is harmless on a
// seeded test database. The existing-account test needs the seeded owner:
//   E2E_OWNER_EMAIL=saloon@book.az E2E_OWNER_PASSWORD=… pnpm e2e onboarding

const az = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as {
  Auth: { emailLabel: string; register: { salonName: string; submit: string } };
  LegalReconsent: { confirm: string; accept: string };
  Help: { fab: string; setup: { title: string } };
  Onboarding: {
    welcome: { title: string; start: string };
    checklist: {
      title: string;
      progress: string;
      hide: string;
      hiddenNote: string;
      showHow: string;
      items: Record<string, { title: string }>;
    };
  };
  Guides: {
    ui: { done: string };
    guides: { salonProfile: { steps: Record<string, { do: string }> } };
  };
};
const ob = az.Onboarding;
const progress = (done: number) =>
  ob.checklist.progress.replace("{done}", String(done)).replace("{total}", "6");

const card = (page: Page) => page.locator('[data-guide-layer="card"]');

/**
 * The copy of an anchor that is actually on screen — what the guide points at.
 * (The menu exists twice; the phone drawer's copy is off-screen until opened.)
 */
async function onScreen(page: Page, name: string) {
  const sel = `[data-tour="${name}"]`;
  const i = await page.$$eval(sel, (els) =>
    els.findIndex((e) => {
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
    }),
  );
  return page.locator(sel).nth(i);
}
const checklist = (page: Page) => page.locator('[data-tour="today.checklist"]');

async function register(page: Page) {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e4)}`;
  await page.goto("/register");
  await page.getByLabel(az.Auth.register.salonName).fill(`E2E Onboarding ${stamp}`);
  await page.getByLabel(az.Auth.emailLabel).fill(`e2e-onboarding-${stamp}@example.com`);
  for (const field of await page.locator('input[autocomplete="new-password"]').all()) {
    await field.fill("Onb0arding!x");
  }
  await page.locator('input[type="checkbox"]').first().check();
  await page.getByRole("button", { name: az.Auth.register.submit, exact: true }).click();
  await page.waitForURL(/\/dashboard$/);
}

for (const viewport of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "phone 360", size: { width: 360, height: 740 } },
]) {
  test.describe(`first run (${viewport.name})`, () => {
    test.use({ viewport: viewport.size });

    test("welcome, checklist, a guide ticks an item, hide and bring back", async ({ page }) => {
      await register(page);

      // The welcome, once.
      const welcome = page.getByRole("dialog", { name: ob.welcome.title });
      await expect(welcome).toBeVisible();
      await welcome.getByRole("button", { name: ob.welcome.start }).click();
      await expect(welcome).toHaveCount(0);

      // The checklist, from the data: a fresh salon has done nothing yet.
      await expect(checklist(page)).toBeVisible();
      await expect(checklist(page)).toContainText(progress(0));

      // "Show me how" on the profile item walks the real Settings form.
      const profileRow = checklist(page).locator("li", { hasText: ob.checklist.items.profile.title });
      await profileRow.getByRole("button", { name: ob.checklist.showHow }).click();
      const steps = az.Guides.guides.salonProfile.steps;
      await expect(card(page)).toContainText(steps.openPage.do);
      await (await onScreen(page, "nav.settings")).click();
      await page.waitForURL(/\/dashboard\/settings$/);
      await expect(card(page)).toContainText(steps.phone.do);
      await page.locator('[data-tour="settings.phone"]').fill("+994501112233");
      await page.locator('[data-tour="settings.phone"]').press("Enter");
      await expect(card(page)).toContainText(steps.address.do);
      await page.locator('[data-tour="settings.address"]').fill("Nizami küç. 1");
      await page.locator('[data-tour="settings.address"]').press("Enter");
      await expect(card(page)).toContainText(steps.save.do);
      await page.locator('[data-tour="settings.profile-save"]').click();
      await expect(card(page)).toContainText(steps.done.do);
      await card(page).getByRole("button", { name: az.Guides.ui.done }).click();

      // Back on Today, the item is ticked by the saved data.
      await page.goto("/dashboard");
      await expect(checklist(page)).toContainText(progress(1));

      // Hide: it says where it went, stays hidden on reload, and comes back
      // from the help panel.
      await checklist(page).getByRole("button", { name: ob.checklist.hide }).click();
      await expect(page.getByText(ob.checklist.hiddenNote)).toBeVisible();
      await page.reload();
      await expect(checklist(page)).toHaveCount(0);
      // …and the welcome does not come back either.
      await expect(page.getByRole("dialog", { name: ob.welcome.title })).toHaveCount(0);

      await page.getByRole("button", { name: az.Help.fab }).click();
      await page.getByRole("button", { name: new RegExp(az.Help.setup.title) }).click();
      await expect(checklist(page)).toBeVisible();
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

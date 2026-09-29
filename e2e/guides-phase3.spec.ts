import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { copy } from "./fixtures";

// Smoke for the third batch of guides and the help search, on the seeded
// owner: search by a synonym in another language, a master's login handed out
// end to end, time off added, the way to pay, and the new Plan menu entry at
// phone width.
//
//   E2E_OWNER_EMAIL=saloon@book.az E2E_OWNER_PASSWORD=… pnpm e2e guides-phase3
//
// Writes to the seeded database: one master login (a unique e-mail per run,
// or a password reset once every master has one) and one day of time off.

const email = process.env.E2E_OWNER_EMAIL;
const password = process.env.E2E_OWNER_PASSWORD;

type Steps = Record<string, { do: string }>;
const az = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as {
  Nav: { billing: string };
  Help: { fab: string; search: { label: string; noResults: string } };
  LegalReconsent: { confirm: string; accept: string };
  Guides: {
    ui: { next: string; done: string };
    guides: Record<"masterLogin" | "timeOff" | "payPlan", { title: string; steps: Steps }>;
  };
};
const G = az.Guides.guides;
const card = (page: Page) => page.locator('[data-guide-layer="card"]');

async function logIn(page: Page) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(email!);
  await page.locator('input[autocomplete="current-password"]').fill(password!);
  await page.getByRole("button", { name: copy.loginSubmit, exact: true }).click();
  await page.waitForURL(/\/dashboard/);
  const accept = page.getByRole("button", { name: az.LegalReconsent.accept, exact: true });
  if (await accept.isVisible().catch(() => false)) {
    await page.getByLabel(az.LegalReconsent.confirm).check();
    await accept.click();
    await expect(accept).toHaveCount(0);
  }
}

async function openHelp(page: Page) {
  await page.getByRole("button", { name: az.Help.fab }).click();
}

const next = (page: Page) => card(page).getByRole("button", { name: az.Guides.ui.next }).click();

test.describe("phase 3 guides", () => {
  test.skip(!email || !password, "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD not set");
  test.use({ viewport: { width: 1280, height: 800 } });

  test("search finds a task by a synonym in another language", async ({ page }) => {
    await logIn(page);
    await openHelp(page);
    const search = page.getByRole("searchbox", { name: az.Help.search.label });
    // Russian, typed Latin, into the Azerbaijani UI.
    await search.fill("parol");
    const results = page.getByRole("list", { name: az.Help.search.label });
    await expect(results.getByRole("button").first()).toContainText(G.masterLogin.title);
    await search.fill("mezuniyyet");
    await expect(results.getByRole("button").first()).toContainText(G.timeOff.title);
    await search.fill("zzzqqq");
    await expect(page.getByText(az.Help.search.noResults)).toBeVisible();
  });

  test("hands a master a login, end to end", async ({ page }) => {
    await logIn(page);
    await openHelp(page);
    await page.getByRole("searchbox", { name: az.Help.search.label }).fill("parol");
    await page.getByRole("button", { name: G.masterLogin.title }).click();
    const s = G.masterLogin.steps;

    await expect(card(page)).toContainText(s.openPage.do);
    await page.locator('[data-tour="nav.workers"]:visible').click();
    await expect(card(page)).toContainText(s.openAccess.do);
    await page.locator('[data-tour="worker.access"]').first().click();

    await expect(card(page)).toContainText(s.email.do);
    const emailField = page.locator('input[data-tour="access.email"]');
    if (await emailField.count()) {
      await emailField.fill(`e2e-master-${Date.now()}@example.com`);
      await emailField.press("Tab");
    } else {
      await next(page); // every master already has a login: this is a reset
    }
    await expect(card(page)).toContainText(s.password.do);
    await page.locator('[data-tour="access.password"]').fill("E2e-Master-1!");
    await page.locator('[data-tour="access.password"]').press("Tab");

    await expect(card(page)).toContainText(s.save.do);
    await page.locator('[data-tour="access.save"]').click();
    // Finishes on the issued password, not on the press.
    await expect(card(page)).toContainText(s.handOver.do);
    await expect(page.locator('[data-tour="access.issued"]')).toBeVisible();
    await next(page);
    await expect(card(page)).toContainText(s.done.do);
    await card(page).getByRole("button", { name: az.Guides.ui.done }).click();
  });

  test("adds a day of time off and waits for the save", async ({ page }) => {
    await logIn(page);
    await page.goto("/dashboard/workers");
    await openHelp(page);
    await page.getByRole("button", { name: G.timeOff.title }).click();
    const s = G.timeOff.steps;
    await expect(card(page)).toContainText(s.openModal.do);
    await page.locator('[data-tour="worker.timeoff"]').first().click();
    await expect(card(page)).toContainText(s.from.do);
    await next(page); // today, pre-filled
    await expect(card(page)).toContainText(s.to.do);
    await next(page);
    await expect(card(page)).toContainText(s.reason.do);
    await next(page);
    await expect(card(page)).toContainText(s.save.do);
    await page.locator('[data-tour="timeoff.save"]').click();
    await expect(page.locator('[data-tour="timeoff.added"]')).toBeVisible();
    await expect(card(page)).toContainText(s.done.do);
  });

  test("shows the way to pay from the new Plan menu entry", async ({ page }) => {
    await logIn(page);
    await openHelp(page);
    await page.getByRole("button", { name: G.payPlan.title }).click();
    const s = G.payPlan.steps;
    await expect(card(page)).toContainText(s.openPage.do);
    await page.locator('[data-tour="nav.billing"]:visible').click();
    await page.waitForURL(/\/dashboard\/billing$/);
    await expect(card(page)).toContainText(s.status.do);
    await next(page);
    await expect(card(page)).toContainText(s.pay.do);
    // Any press on the plans finishes it; a plan's title keeps WhatsApp closed here.
    await page.locator('[data-tour="billing.plans"] h2').first().click();
    await expect(card(page)).toContainText(s.done.do);
  });
});

test.describe("Plan menu entry at 360px", () => {
  test.skip(!email || !password, "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD not set");
  test.use({ viewport: { width: 360, height: 740 } });

  test("sits in the drawer, fits, and is not in the bottom tab bar", async ({ page }) => {
    await logIn(page);
    await page.locator('[data-tour="nav.menu"]').click();
    const drawer = page.locator("aside.fixed");
    const entry = drawer.getByRole("link", { name: az.Nav.billing });
    await expect(entry).toBeVisible();
    // Nothing in the drawer spills sideways.
    const overflow = await drawer.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
    const box = await entry.boundingBox();
    const drawerBox = await drawer.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(drawerBox!.x + drawerBox!.width);
    // Not a tab.
    await expect(page.locator("nav.fixed").getByRole("link", { name: az.Nav.billing })).toHaveCount(0);
  });
});

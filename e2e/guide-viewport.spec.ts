import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { copy } from "./fixtures";

// The guide's spotlight against a real layout at phone width: an element below
// the fold (auto-scroll, hole on it, card not covering it), an element in the
// page but boxless (the "not on screen" card, then the not-found fallback),
// and pinch zoom through Chromium's page scale (hole still on the element,
// card inside the visible area, its buttons still pressable).
//
// Needs the seeded owner, like guide.spec.ts:
//   E2E_OWNER_EMAIL=saloon@book.az E2E_OWNER_PASSWORD=… pnpm e2e guide-viewport

const email = process.env.E2E_OWNER_EMAIL;
const password = process.env.E2E_OWNER_PASSWORD;

const az = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as {
  Help: { fab: string };
  LegalReconsent: { confirm: string; accept: string };
  Guides: {
    ui: { exit: string; notFound: { title: string }; offscreen: { title: string } };
    guides: { addService: { title: string; steps: Record<string, { do: string }> } };
  };
};
const steps = az.Guides.guides.addService.steps;
const card = (page: Page) => page.locator('[data-guide-layer="card"]');
const ring = (page: Page) => page.locator('[data-guide-layer="ring"]');
const addButton = (page: Page) => page.locator('[data-tour="service.add"]');

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

async function startAddService(page: Page) {
  await page.getByRole("button", { name: az.Help.fab }).click();
  await page.getByRole("button", { name: az.Guides.guides.addService.title }).click();
}

/** Client rects of the ring and the element, from one frame. */
function rects(page: Page) {
  return page.evaluate(() => {
    const r = (sel: string) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: b.top, left: b.left, width: b.width, height: b.height };
    };
    const vv = window.visualViewport!;
    return {
      ring: r('[data-guide-layer="ring"]'),
      target: r('[data-tour="service.add"]'),
      card: r('[data-guide-layer="card"]'),
      vv: { top: vv.offsetTop, left: vv.offsetLeft, width: vv.width, height: vv.height, scale: vv.scale },
    };
  });
}

/** The ring wraps the element: same centre, a few pixels of padding all round. */
function expectRingOn(m: Awaited<ReturnType<typeof rects>>) {
  expect(m.ring, "ring drawn").not.toBeNull();
  expect(m.target, "element present").not.toBeNull();
  const ring = m.ring!;
  const el = m.target!;
  expect(Math.abs(ring.left + ring.width / 2 - (el.left + el.width / 2))).toBeLessThan(2);
  expect(Math.abs(ring.top + ring.height / 2 - (el.top + el.height / 2))).toBeLessThan(2);
  expect(ring.width).toBeGreaterThan(el.width);
  expect(ring.width - el.width).toBeLessThan(16);
}

test.describe("guide spotlight at 360px", () => {
  test.skip(!email || !password, "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD not set");
  test.use({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true });

  test("scrolls to an element below the fold and puts the hole on it", async ({ page }) => {
    await logIn(page);
    await page.goto("/dashboard/services");
    // Push the page's content far below the fold (a stylesheet, which React
    // leaves alone, rather than an injected node it would reconcile away).
    await page.addStyleTag({ content: "main { padding-top: 2400px !important; }" });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(addButton(page)).not.toBeInViewport();

    await startAddService(page);
    await expect(card(page)).toContainText(steps.openForm.do);
    // Scrolled into view, the hole on it, and the sheet not covering it.
    await expect(addButton(page)).toBeInViewport();
    await expect(ring(page)).toBeVisible();
    await expect.poll(async () => {
      const m = await rects(page);
      return m.ring && m.target ? Math.abs(m.ring.top + m.ring.height / 2 - (m.target.top + m.target.height / 2)) : 99;
    }).toBeLessThan(2);
    const m = await rects(page);
    expectRingOn(m);
    expect(m.target!.top + m.target!.height).toBeLessThanOrEqual(m.card!.top);

    // Scroll it away by hand: no ring in a corner, an arrow pointing down that brings it back.
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(ring(page)).toHaveCount(0);
    const arrow = page.locator('[data-guide-layer="arrow"]');
    await expect(arrow).toBeVisible();
    await arrow.click();
    await expect(addButton(page)).toBeInViewport();
    await expect(ring(page)).toBeVisible();
  });

  test("an element with no box: no hole, a 'not on screen' card, then the not-found fallback", async ({ page }) => {
    await logIn(page);
    await page.goto("/dashboard/services");
    await page.addStyleTag({ content: '[data-tour="service.add"] { display: none !important; }' });
    await startAddService(page);
    await expect(card(page)).toContainText(az.Guides.ui.offscreen.title);
    await expect(ring(page)).toHaveCount(0);
    await expect(card(page)).toContainText(az.Guides.ui.notFound.title, { timeout: 8000 });
  });

});

test.describe("guide spotlight under pinch zoom (360px)", () => {
  test.skip(!email || !password, "E2E_OWNER_EMAIL / E2E_OWNER_PASSWORD not set");
  // Not isMobile: Chromium pans the zoomed-in visual viewport with the wheel,
  // which a touch-emulated page does not take.
  test.use({ viewport: { width: 360, height: 740 } });

  test("pinch zoom: the hole stays on the element and the card stays reachable", async ({ page }) => {
    await logIn(page);
    await page.goto("/dashboard/services");
    await startAddService(page);
    await expect(card(page)).toContainText(steps.openForm.do);

    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 2 });
    await expect.poll(async () => (await rects(page)).vv.scale).toBe(2);
    // Pan the zoomed-in window off the corner, as a finger would: the case the
    // real phone broke on (visual viewport offset ≠ 0).
    await page.mouse.move(90, 180);
    await page.mouse.wheel(40, 60);
    await expect.poll(async () => {
      const { vv } = await rects(page);
      return vv.left > 0 && vv.top > 0;
    }).toBe(true);

    // Wherever the zoomed window sits, the hole follows the element.
    await expect.poll(async () => {
      const m = await rects(page);
      if (!m.ring || !m.target) return 99;
      return Math.abs(m.ring.left + m.ring.width / 2 - (m.target.left + m.target.width / 2));
    }).toBeLessThan(2);
    expectRingOn(await rects(page));

    // The card lives inside the zoomed-in window, whole.
    const m = await rects(page);
    expect(m.card!.left).toBeGreaterThanOrEqual(m.vv.left - 1);
    expect(m.card!.top).toBeGreaterThanOrEqual(m.vv.top - 1);
    expect(m.card!.left + m.card!.width).toBeLessThanOrEqual(m.vv.left + m.vv.width + 1);
    expect(m.card!.top + m.card!.height).toBeLessThanOrEqual(m.vv.top + m.vv.height + 1);

    // …and its buttons still work.
    await card(page).getByRole("button", { name: az.Guides.ui.exit }).last().click();
    await expect(card(page)).toHaveCount(0);
    await cdp.send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  });
});

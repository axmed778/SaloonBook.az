import { test, expect } from "@playwright/test";
import { copy, salon } from "./fixtures";

// The public booking page is the product's growth loop: it is the one URL a
// salon shares with its customers. If it stops rendering, nothing else about
// the deploy matters — so this is the first thing the smoke suite proves.
test.describe("public booking page", () => {
  test("renders the salon and its booking widget", async ({ page }) => {
    const response = await page.goto(`/${salon.slug}`);

    // notFound() for an unknown/inactive slug answers 404 — assert the status
    // explicitly, otherwise a 404 page that happens to contain the salon name
    // would pass the content checks below.
    expect(response?.status()).toBe(200);

    // The salon name is the <h1> of the page (src/app/[locale]/[slug]/page.tsx).
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(salon.name);

    // Per-salon metadata, not the generic boilerplate — a shared link previews
    // the salon, so a regression here is invisible in the UI but very visible
    // in WhatsApp.
    await expect(page).toHaveTitle(new RegExp(salon.name));

    // The widget itself mounted (client component, so this also proves the page
    // hydrated under the production CSP rather than just server-rendering).
    await expect(page.getByText(copy.bookingEyebrow)).toBeVisible();
  });

  test("answers 404 for an unknown salon", async ({ page }) => {
    const response = await page.goto("/e2e-no-such-salon-slug");
    expect(response?.status()).toBe(404);
  });
});

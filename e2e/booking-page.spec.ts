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

  // Children's services: the seeded kids' haircut adds "Uşaq" to the first
  // step, a child sees only kids' services, and only masters who work with
  // children. Nothing is booked, so the run leaves the database as it was.
  test("booking for a child shows only kids' services and masters", async ({ page }) => {
    test.skip(
      salon.slug !== "demostudio",
      "the kids' service is part of the demostudio seed (prisma/seed.ts)",
    );
    await page.goto(`/${salon.slug}`);
    const widget = page.locator("section").filter({ hasText: copy.bookingWhoStep }).first();

    await widget.getByRole("button", { name: copy.audience.MALE, exact: true }).waitFor();
    const kidOption = widget.getByRole("button", { name: copy.audience.KID, exact: true });
    // prisma/seed.ts skips a demostudio that already exists, so a database seeded
    // before the kids' service was added has none. Locally that's a stale seed,
    // not a regression; CI always seeds a fresh database, so there it must fail.
    test.skip(
      !process.env.CI && (await kidOption.count()) === 0,
      "demostudio was seeded before its kids' service existed: drop and reseed it",
    );
    await kidOption.click();

    // Only the kids' haircut is offered; the adult haircut and manicure are not.
    await expect(widget.getByRole("button", { name: /Uşaq saç kəsimi/ })).toBeVisible();
    await expect(widget.getByRole("button", { name: /^Saç kəsimi/ })).toHaveCount(0);
    await expect(widget.getByRole("button", { name: /Manikür/ })).toHaveCount(0);

    // Both masters are linked to it, but Leyla doesn't take children.
    await widget.getByRole("button", { name: /Uşaq saç kəsimi/ }).click();
    await expect(widget.getByRole("button", { name: /Ayan/ })).toBeVisible();
    await expect(widget.getByRole("button", { name: /Leyla/ })).toHaveCount(0);
  });

  test("answers 404 for an unknown salon", async ({ page }) => {
    const response = await page.goto("/e2e-no-such-salon-slug");
    expect(response?.status()).toBe(404);
  });
});

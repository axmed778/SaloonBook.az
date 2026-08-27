import { test, expect } from "@playwright/test";
import { badCredentials, copy } from "./fixtures";

test.describe("owner login", () => {
  test("rejects a bad password with a visible error", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(copy.loginTitle);

    const { email, password } = badCredentials();
    await page.locator('input[type="email"]').fill(email);
    // Located by autocomplete, not by type: the "show password" toggle flips
    // the input between type=password and type=text.
    await page.locator('input[autocomplete="current-password"]').fill(password);

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: copy.loginSubmit, exact: true }).click(),
    ]);

    // 401, not 429: a rate-limited run would also "fail to log in" and would
    // silently stop testing the credential check at all.
    expect(response.status()).toBe(401);

    // Assert the API's own message is rendered rather than a hardcoded string —
    // that proves the form surfaced the server error instead of swallowing it,
    // without pinning the spec to one translation.
    const body = (await response.json()) as { error?: string };
    expect(body.error).toBeTruthy();
    await expect(page.getByText(body.error as string)).toBeVisible();

    // Still on /login — no session was issued.
    await expect(page).toHaveURL(/\/login$/);
    const cookies = await page.context().cookies();
    // sb_session is set only by setSession() (src/lib/auth/session.ts).
    expect(cookies.some((c) => c.name === "sb_session")).toBe(false);
  });
});

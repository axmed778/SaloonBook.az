import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { registerSalon, walkSetupGate } from "./setup-flow";

// "Hide list" must survive a reload that aborts its save. The save is a
// server action; a reload (or a tab closed) right after the press cancels it
// in flight. The intent is kept in the browser until the server confirms, and
// the next load replays it — this aborts the save on purpose to prove it.
//
// Registers a fresh account (a unique email), harmless on a seeded test database.

const az = JSON.parse(
  readFileSync(fileURLToPath(new URL("../messages/az.json", import.meta.url)), "utf8"),
) as {
  Onboarding: { checklist: { hide: string } };
};

test("hide, then reload before the save lands: the hide survives", async ({ page }) => {
  await registerSalon(page, "hide", 1);
  // The checklist is only reachable past the mandatory setup gate.
  await walkSetupGate(page);

  const list = page.locator('[data-tour="today.checklist"]');
  await expect(list).toBeVisible();

  // Every server action fails, as it would when the reload cuts it off.
  const isAction = (method: string, headers: Record<string, string>) => method === "POST" && !!headers["next-action"];
  await page.route("**/*", (r) =>
    isAction(r.request().method(), r.request().headers()) ? r.abort() : r.continue(),
  );
  const failed = page.waitForEvent("requestfailed", (r) => isAction(r.method(), r.headers()));
  await page.getByRole("button", { name: az.Onboarding.checklist.hide }).click();
  await failed;
  await page.unroute("**/*");

  // Reload: the intent is replayed from the browser and sent again.
  const replayed = page.waitForResponse((r) => isAction(r.request().method(), r.request().headers()));
  await page.reload();
  await expect(list).toHaveCount(0);
  await replayed;
  // The server has it now: hidden on a plain reload too.
  await page.reload();
  await expect(list).toHaveCount(0);
});

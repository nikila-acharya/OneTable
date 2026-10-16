import { expect, test } from "@playwright/test";

test("homepage serves the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/OneTable/);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

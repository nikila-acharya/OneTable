/**
 * t_02ae1826 — ON01 visual snapshots at 390 px and 1280 px (PRD §16.7).
 *
 * Each step is reached by seeding "onetable:onboarding:v1" before first
 * paint (the §5.0 resume path), never by clicking — so the snapshots are
 * deterministic and the flow itself stays covered by the vitest tests.
 * Layout/copy baseline is design/prototype.html (WP-0.6, branch
 * wp/1.6-onboarding-t2f8df0c9): steps 1, 2, 3, 4, 6 and the Done screen.
 */

import { expect, test } from "@playwright/test";
import { SCREEN_SEEDS, bootWithDraft } from "./fixtures";

const SCREENS = [
  { key: "step-1", label: "section[aria-label=\"Welcome\"]" },
  { key: "step-2", label: "section[aria-label=\"Your household\"]" },
  { key: "step-3", label: "section[aria-label=\"Family members\"]" },
  { key: "step-4", label: "section[aria-label=\"Meals to plan\"]" },
  { key: "step-5", label: "section[aria-label=\"Where your food comes from\"]" },
  { key: "step-6", label: "section[aria-label=\"Review and first plan\"]" },
  { key: "done", label: "section[aria-label=\"Setup complete\"]" },
] as const;

for (const s of SCREENS) {
  test(`ON01 ${s.key} visual snapshot`, async ({ page }) => {
    let planningRequested = false;
    if (s.key === "step-6") {
      // Registered BEFORE the page loads: a spy attached after boot could never
      // observe a mount-time request, which is exactly what must not happen.
      await page.route("**/api/plans/first", (route) => {
        planningRequested = true;
        void route.fulfill({
          status: 401,
          contentType: "application/json",
          body: '{"error":"unauthenticated"}',
        });
      });
    }

    await bootWithDraft(page, SCREEN_SEEDS[s.key]);
    // The awaited screen proves hydration resumed at the seeded step.
    await expect(page.locator(s.label)).toBeVisible();

    // Step 6 used to be asserted through the stub card ("Approval card preview"
    // plus a frozen "Draft week · Mon, Oct 19"), i.e. the test pinned a screen that
    // claimed a drafted week without asking for one. Those assertions were
    // replaced, not deleted: step 6 must now resume honestly, and mounting must
    // not create a plan. The week table itself is covered by
    // src/app/onboarding/steps/review.plan.test.tsx, which stubs the endpoint
    // and asserts the rendered rows; a browser test is the wrong place to pin
    // planner output.
    if (s.key === "step-6") {
      await expect(page.getByText(/already asked for a draft week once/)).toBeVisible();
      await expect(page.getByRole("group", { name: "Drafted week" })).toHaveCount(0);
      await expect(page.getByRole("alert", { name: "First plan result" })).toHaveCount(0);
      expect(planningRequested).toBe(false);
    }

    await expect(page).toHaveScreenshot(`${s.key}.png`, { fullPage: true });
  });
}

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
  { key: "step-6", label: "section[aria-label=\"Review and first plan\"]" },
  { key: "done", label: "section[aria-label=\"Setup complete\"]" },
] as const;

for (const s of SCREENS) {
  test(`ON01 ${s.key} visual snapshot`, async ({ page }) => {
    await bootWithDraft(page, SCREEN_SEEDS[s.key]);
    // The awaited screen proves hydration resumed at the seeded step.
    await expect(page.locator(s.label)).toBeVisible();

    // Step 6 renders in the approval phase (firstPlanRequestedAt seeded):
    // assert the stub card and the frozen "next Monday" label are present so
    // a regression that silently falls back to Welcome can never pass.
    if (s.key === "step-6") {
      await expect(page.getByRole("group", { name: "Approval card preview" })).toBeVisible();
      await expect(page.getByText("Draft week · Mon, Oct 19")).toBeVisible();
    }

    await expect(page).toHaveScreenshot(`${s.key}.png`, { fullPage: true });
  });
}

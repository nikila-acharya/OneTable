/**
 * t_02ae1826 — axe-core in a real browser over every ON01 screen (§16.7).
 *
 * The jsdom smoke pass (src/app/onboarding/axe.test.tsx) must disable
 * colour-contrast because jsdom cannot compute it from CSS. Here Chromium
 * renders the production build, so contrast runs for real: every screen is
 * asserted to have zero serious/critical violations AND the color-contrast
 * rule must actually evaluate (no "incomplete", not absent).
 */

import { AxeBuilder } from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { SCREEN_SEEDS, bootWithDraft } from "./fixtures";

const SCREENS = [
  { key: "step-1", label: 'section[aria-label="Welcome"]' },
  { key: "step-2", label: 'section[aria-label="Your household"]' },
  { key: "step-3", label: 'section[aria-label="Family members"]' },
  { key: "step-4", label: 'section[aria-label="Meals to plan"]' },
  { key: "step-6", label: 'section[aria-label="Review and first plan"]' },
  { key: "done", label: 'section[aria-label="Setup complete"]' },
] as const;

for (const s of SCREENS) {
  test(`ON01 ${s.key} — axe (incl. real colour-contrast)`, async ({ page }) => {
    await bootWithDraft(page, SCREEN_SEEDS[s.key]);
    await expect(page.locator(s.label)).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();

    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([]);

    // Contrast must be genuinely computed: appear in passes/violations and
    // never land in "incomplete" (which is where jsdom hides).
    const evaluated = [...results.passes, ...results.violations, ...results.incomplete];
    const cc = evaluated.find((r) => r.id === "color-contrast");
    expect(cc, "color-contrast rule did not run").toBeTruthy();
    const incompleteContrast = results.incomplete.filter((r) => r.id === "color-contrast");
    expect(incompleteContrast, "color-contrast could not be decided").toEqual([]);

    // Any remaining non-serious violations are reported for visibility.
    if (results.violations.length > 0) {
      console.log(`[axe:${s.key}] moderate/minor violations:`, JSON.stringify(results.violations, null, 2));
    }
  });
}

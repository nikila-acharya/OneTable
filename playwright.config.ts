/**
 * t_02ae1826 — Playwright visual snapshots for the ON01 onboarding screens
 * (PRD §16.7: "Playwright visual snapshots exist for each onboarding step at
 * 390 px and 1280 px"). Runs against the production build (`next start`) so
 * what ships is what is snapshotted, and also drives axe-core in a real
 * browser where colour-contrast can actually be computed (jsdom cannot —
 * see src/app/onboarding/axe.test.tsx header).
 */

import { defineConfig } from "@playwright/test";

const PORT = 3110;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: {
    toHaveScreenshot: {
      // Freeze CSS animations/transitions before capture and tolerate font
      // hinting noise; baseline diffs beyond this fail the run.
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "off",
    video: "off",
  },
  /* Snapshot names omit {platform} so the committed baselines (generated on
     this Windows host) diff identically wherever the suite runs later. */
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-projectName}{ext}",
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/onboarding`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
  projects: [
    {
      name: "mobile-390",
      use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
    },
    {
      name: "desktop-1280",
      use: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
    },
  ],
});

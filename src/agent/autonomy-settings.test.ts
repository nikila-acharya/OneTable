/**
 * WP-4.10 — Autonomy Settings tests.
 * Tests cover: settings CRUD, defaults per agent, toggle validation, enforcement.
 * Test data only — never real family data.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_IDS,
  AgentAutonomySetting,
  AutonomySettings,
  AgentId,
} from "./autonomy-settings";

describe("AutonomySettings — defaults and initialization", () => {
  it("initializes with factory defaults for all agents when no persisted state is provided", () => {
    const settings = new AutonomySettings();

    // Setup: auto by default
    expect(settings.get(AGENT_IDS.SETUP).auto_enabled).toBe(true);
    expect(settings.get(AGENT_IDS.SETUP).approval_required).toBe(false);

    // Scout: approval required by default (safety)
    expect(settings.get(AGENT_IDS.SCOUT).auto_enabled).toBe(false);
    expect(settings.get(AGENT_IDS.SCOUT).approval_required).toBe(true);

    // MealPlanner: auto by default (trusted)
    expect(settings.get(AGENT_IDS.MEAL_PLANNER).auto_enabled).toBe(true);
    expect(settings.get(AGENT_IDS.MEAL_PLANNER).approval_required).toBe(false);

    // Reviewer: advisory-only
    expect(settings.get(AGENT_IDS.REVIEWER).auto_enabled).toBe(false);
    expect(settings.get(AGENT_IDS.REVIEWER).approval_required).toBe(false);
  });

  it("restores persisted settings and merges with defaults for missing agents", () => {
    const persisted = {
      [AGENT_IDS.SETUP]: {
        agent_id: AGENT_IDS.SETUP,
        auto_enabled: false, // user disabled
        approval_required: true,
        notify_on_change: true,
      },
    };

    const settings = new AutonomySettings(persisted);

    // Setup: restored from persisted
    expect(settings.get(AGENT_IDS.SETUP).auto_enabled).toBe(false);
    expect(settings.get(AGENT_IDS.SETUP).approval_required).toBe(true);

    // Scout: defaults (not in persisted)
    expect(settings.get(AGENT_IDS.SCOUT).auto_enabled).toBe(false);
    expect(settings.get(AGENT_IDS.SCOUT).approval_required).toBe(true);
  });

  it("returns a deep copy from get() so mutations don't affect internal state", () => {
    const settings = new AutonomySettings();
    const setting1 = settings.get(AGENT_IDS.SETUP);
    setting1.auto_enabled = false;
    setting1.notify_on_change = true;

    const setting2 = settings.get(AGENT_IDS.SETUP);
    expect(setting2.auto_enabled).toBe(true); // unchanged
    expect(setting2.notify_on_change).toBe(false); // unchanged
  });
});

describe("AutonomySettings — CRUD operations", () => {
  let settings: AutonomySettings;

  beforeEach(() => {
    settings = new AutonomySettings();
  });

  it("sets new autonomy settings for an agent", () => {
    settings.set(AGENT_IDS.SETUP, {
      auto_enabled: false,
      notify_on_change: true,
    });

    const updated = settings.get(AGENT_IDS.SETUP);
    expect(updated.auto_enabled).toBe(false);
    expect(updated.notify_on_change).toBe(true);
    expect(updated.approval_required).toBe(false); // unchanged
  });

  it("serializes all settings to JSON for persistence", () => {
    settings.set(AGENT_IDS.SCOUT, { auto_enabled: true });
    settings.set(AGENT_IDS.MEAL_PLANNER, { notify_on_change: false });

    const json = settings.toJSON();
    expect(json[AGENT_IDS.SCOUT].auto_enabled).toBe(true);
    expect(json[AGENT_IDS.MEAL_PLANNER].notify_on_change).toBe(false);
    expect(json[AGENT_IDS.SETUP].auto_enabled).toBe(true); // unchanged
  });

  it("getAllAgentIds returns all supported agent IDs", () => {
    const ids = settings.getAllAgentIds();
    expect(ids).toContain(AGENT_IDS.SETUP);
    expect(ids).toContain(AGENT_IDS.SCOUT);
    expect(ids).toContain(AGENT_IDS.MEAL_PLANNER);
    expect(ids).toContain(AGENT_IDS.REVIEWER);
    expect(ids).toHaveLength(4);
  });

  it("resets all settings to factory defaults", () => {
    settings.set(AGENT_IDS.SETUP, { auto_enabled: false });
    settings.set(AGENT_IDS.SCOUT, { auto_enabled: true });

    settings.resetToDefaults();

    expect(settings.get(AGENT_IDS.SETUP).auto_enabled).toBe(true);
    expect(settings.get(AGENT_IDS.SCOUT).auto_enabled).toBe(false);
  });
});

describe("AutonomySettings — toggle operations", () => {
  let settings: AutonomySettings;

  beforeEach(() => {
    settings = new AutonomySettings();
  });

  it("toggleAuto(true) enables auto-run when approval is not required", () => {
    settings.set(AGENT_IDS.SETUP, { auto_enabled: false });
    settings.toggleAuto(AGENT_IDS.SETUP, true);
    expect(settings.get(AGENT_IDS.SETUP).auto_enabled).toBe(true);
  });

  it("toggleAuto(false) disables auto-run", () => {
    settings.set(AGENT_IDS.MEAL_PLANNER, { auto_enabled: true });
    settings.toggleAuto(AGENT_IDS.MEAL_PLANNER, false);
    expect(settings.get(AGENT_IDS.MEAL_PLANNER).auto_enabled).toBe(false);
  });

  it("toggleApprovalRequired disables auto when requiring approval", () => {
    settings.set(AGENT_IDS.SETUP, { auto_enabled: true, approval_required: false });
    settings.toggleApprovalRequired(AGENT_IDS.SETUP, true);

    const updated = settings.get(AGENT_IDS.SETUP);
    expect(updated.approval_required).toBe(true);
    expect(updated.auto_enabled).toBe(false); // auto disabled to maintain invariant
  });

  it("toggleNotifyOnChange updates the notification preference", () => {
    settings.toggleNotifyOnChange(AGENT_IDS.SETUP, true);
    expect(settings.get(AGENT_IDS.SETUP).notify_on_change).toBe(true);

    settings.toggleNotifyOnChange(AGENT_IDS.SETUP, false);
    expect(settings.get(AGENT_IDS.SETUP).notify_on_change).toBe(false);
  });
});

describe("AutonomySettings — enforcement (constraint validation)", () => {
  let settings: AutonomySettings;

  beforeEach(() => {
    settings = new AutonomySettings();
  });

  it("throws an error when trying to set auto_enabled=true with approval_required=true", () => {
    expect(() => {
      settings.set(AGENT_IDS.SETUP, {
        auto_enabled: true,
        approval_required: true,
      });
    }).toThrow(
      /Cannot enable auto-run when approval is required/
    );
  });

  it("blocks toggleAuto(true) if approval_required is already true", () => {
    settings.set(AGENT_IDS.SETUP, {
      auto_enabled: false,
      approval_required: true,
    });

    expect(() => {
      settings.toggleAuto(AGENT_IDS.SETUP, true);
    }).toThrow(/Cannot enable auto-run when approval is required/);
  });

  it("allows setting auto_enabled=false even with approval_required=true", () => {
    settings.set(AGENT_IDS.SETUP, {
      approval_required: true,
      auto_enabled: false,
    });

    expect(settings.get(AGENT_IDS.SETUP).auto_enabled).toBe(false);
    expect(settings.get(AGENT_IDS.SETUP).approval_required).toBe(true);
  });

  it("isAutoEnabled returns true only when auto_enabled=true AND approval_required=false", () => {
    // Setup: auto enabled, approval not required → auto runs
    expect(settings.isAutoEnabled(AGENT_IDS.SETUP)).toBe(true);

    // Scout: auto disabled, approval required → does not run auto
    expect(settings.isAutoEnabled(AGENT_IDS.SCOUT)).toBe(false);

    // MealPlanner: auto enabled, approval not required → auto runs
    expect(settings.isAutoEnabled(AGENT_IDS.MEAL_PLANNER)).toBe(true);

    // Reviewer: advisory-only, no approval required, but auto disabled → does not run auto
    expect(settings.isAutoEnabled(AGENT_IDS.REVIEWER)).toBe(false);
  });

  it("Coordinator enforces: blocks auto when approval_required=true (Scout safety example)", () => {
    // Scout starts with approval required (safety default)
    const scout = settings.get(AGENT_IDS.SCOUT);
    expect(scout.approval_required).toBe(true);
    expect(scout.auto_enabled).toBe(false);

    // Coordinator checks isAutoEnabled before sending output
    expect(settings.isAutoEnabled(AGENT_IDS.SCOUT)).toBe(false);

    // Scout output goes to approval inbox instead of direct
    const scoutOutputApprovedForAuto = settings.isAutoEnabled(AGENT_IDS.SCOUT);
    expect(scoutOutputApprovedForAuto).toBe(false);

    // User toggles "Let Scout auto-add recipes" UI toggle (removes approval requirement)
    settings.toggleApprovalRequired(AGENT_IDS.SCOUT, false);
    expect(settings.get(AGENT_IDS.SCOUT).approval_required).toBe(false);

    // Now user must explicitly enable auto for Scout
    settings.toggleAuto(AGENT_IDS.SCOUT, true);
    expect(settings.isAutoEnabled(AGENT_IDS.SCOUT)).toBe(true);
  });

  it("throws error for unknown agent ID", () => {
    expect(() => {
      settings.set("unknown_agent" as AgentId, { auto_enabled: true });
    }).toThrow(/Unknown agent/);
  });
});

describe("AutonomySettings — real user workflow scenarios", () => {
  let settings: AutonomySettings;

  beforeEach(() => {
    settings = new AutonomySettings();
  });

  it("user disables Setup auto-run via UI: Setup still auto-adds, but user sees toggle as off", () => {
    // User clicks "Let Setup auto-collect preferences" toggle OFF
    settings.toggleAuto(AGENT_IDS.SETUP, false);

    // Setup is now disabled from auto-running
    expect(settings.isAutoEnabled(AGENT_IDS.SETUP)).toBe(false);
    expect(settings.get(AGENT_IDS.SETUP).auto_enabled).toBe(false);
  });

  it("user enables Scout auto via UI: Scout auto-adds recipes (approval toggle removed)", () => {
    // Scout starts with approval required
    expect(settings.isAutoEnabled(AGENT_IDS.SCOUT)).toBe(false);

    // User clicks "Let Scout auto-add recipes" UI toggle
    settings.toggleApprovalRequired(AGENT_IDS.SCOUT, false);

    // Scout can now run auto (toggleApprovalRequired disables auto to false, but user can then enable it)
    settings.toggleAuto(AGENT_IDS.SCOUT, true);
    expect(settings.isAutoEnabled(AGENT_IDS.SCOUT)).toBe(true);
  });

  it("user re-enables Scout approval: output goes back to approval inbox", () => {
    // Scout is auto-enabled
    settings.toggleApprovalRequired(AGENT_IDS.SCOUT, false);
    settings.toggleAuto(AGENT_IDS.SCOUT, true);
    expect(settings.isAutoEnabled(AGENT_IDS.SCOUT)).toBe(true);

    // User toggles approval back on
    settings.toggleApprovalRequired(AGENT_IDS.SCOUT, true);

    // Scout is back in approval-only mode
    expect(settings.isAutoEnabled(AGENT_IDS.SCOUT)).toBe(false);
  });

  it("persists and restores user preferences across sessions", () => {
    // User session 1: configure autonomy
    settings.set(AGENT_IDS.SCOUT, {
      auto_enabled: false,
      approval_required: false,
    });
    settings.set(AGENT_IDS.MEAL_PLANNER, {
      auto_enabled: false,
      notify_on_change: true,
    });

    const persisted = settings.toJSON();

    // User session 2: restore from persisted
    const restored = new AutonomySettings(persisted);
    expect(restored.get(AGENT_IDS.SCOUT).approval_required).toBe(false);
    expect(restored.get(AGENT_IDS.MEAL_PLANNER).auto_enabled).toBe(false);
    expect(restored.get(AGENT_IDS.MEAL_PLANNER).notify_on_change).toBe(true);
  });
});

/**
 * WP-4.10 — Autonomy Settings: per-agent user control over auto-run vs approval.
 * Per-household user control over which agents auto-run vs require approval.
 * Stores settings per agent: {agent_id, auto_enabled, approval_required, notify_on_change}.
 *
 * Defaults per agent (from PRD):
 * - Setup: auto_enabled=true (trusted for preference collection)
 * - Scout: approval_required=true, auto_enabled=false (safety: filter allergens)
 * - MealPlanner: auto_enabled=true (trusted planning)
 * - Reviewer: advisory-only (no approval needed, informational)
 */

/**
 * Agent identifiers supported by the autonomy system.
 */
export const AGENT_IDS = {
  SETUP: "setup",
  SCOUT: "scout",
  MEAL_PLANNER: "meal_planner",
  REVIEWER: "reviewer",
} as const;

export type AgentId = (typeof AGENT_IDS)[keyof typeof AGENT_IDS];

/**
 * Per-agent autonomy configuration settings.
 */
export interface AgentAutonomySetting {
  agent_id: AgentId;
  auto_enabled: boolean;
  approval_required: boolean;
  notify_on_change: boolean;
}

/**
 * Default autonomy settings per agent.
 * These are the factory defaults per the PRD §4.10 requirements.
 */
const DEFAULTS: Record<AgentId, AgentAutonomySetting> = {
  [AGENT_IDS.SETUP]: {
    agent_id: AGENT_IDS.SETUP,
    auto_enabled: true,
    approval_required: false,
    notify_on_change: false,
  },
  [AGENT_IDS.SCOUT]: {
    agent_id: AGENT_IDS.SCOUT,
    auto_enabled: false,
    approval_required: true,
    notify_on_change: true,
  },
  [AGENT_IDS.MEAL_PLANNER]: {
    agent_id: AGENT_IDS.MEAL_PLANNER,
    auto_enabled: true,
    approval_required: false,
    notify_on_change: false,
  },
  [AGENT_IDS.REVIEWER]: {
    agent_id: AGENT_IDS.REVIEWER,
    auto_enabled: false,
    approval_required: false,
    notify_on_change: true,
  },
};

/**
 * AutonomySettings class manages per-agent autonomy configuration.
 * - Stores and retrieves agent autonomy settings (auto_enabled, approval_required, notify_on_change)
 * - Enforces constraints: if approval_required=true, auto_enabled must be false
 * - Provides defaults for all known agents
 * - Allows toggling auto-run and approval settings per agent
 */
export class AutonomySettings {
  private settings: Map<AgentId, AgentAutonomySetting> = new Map();

  /**
   * Create a new AutonomySettings instance, optionally loading from persisted state.
   * If no persisted state is provided, uses factory defaults for all agents.
   *
   * @param persisted Optional map of persisted settings; missing agents use defaults
   */
  constructor(persisted?: Partial<Record<AgentId, AgentAutonomySetting>>) {
    // Initialize with defaults
    for (const agentId of Object.values(AGENT_IDS)) {
      this.settings.set(agentId, JSON.parse(JSON.stringify(DEFAULTS[agentId])));
    }

    // Merge in persisted settings (validated)
    if (persisted) {
      for (const [agentId, setting] of Object.entries(persisted)) {
        if (this.isValidAgentId(agentId as string)) {
          const id = agentId as AgentId;
          this.settings.set(id, {
            ...DEFAULTS[id],
            ...(setting as AgentAutonomySetting),
            agent_id: id,
          });
        }
      }
    }
  }

  /**
   * Get autonomy settings for a specific agent.
   * Returns the agent's current settings or default if agent is unknown.
   *
   * @param agentId The agent ID
   * @returns The agent's autonomy settings
   */
  get(agentId: AgentId): AgentAutonomySetting {
    const setting = this.settings.get(agentId);
    if (!setting) {
      return JSON.parse(JSON.stringify(DEFAULTS[agentId] || DEFAULTS[AGENT_IDS.SETUP]));
    }
    return JSON.parse(JSON.stringify(setting));
  }

  /**
   * Set autonomy settings for a specific agent.
   * Validates constraints: if approval_required=true, auto_enabled is set to false.
   * When toggling approval_required to true with auto currently enabled, auto is disabled.
   *
   * @param agentId The agent ID
   * @param settings The new settings (only set fields are updated)
   * @throws Error if constraints are violated
   */
  set(agentId: AgentId, settings: Partial<AgentAutonomySetting>): void {
    if (!this.isValidAgentId(agentId)) {
      throw new Error(`Unknown agent: ${agentId}`);
    }

    const current = this.get(agentId);
    const updated: AgentAutonomySetting = {
      ...current,
      ...settings,
      agent_id: agentId,
    };

    // Enforce constraint: if approval is required, auto must be disabled
    // If user is explicitly setting both approval_required=true and auto_enabled=true, error
    if (updated.approval_required === true && updated.auto_enabled === true) {
      // Check if this is an explicit attempt to set both (not just a side-effect of the merge)
      if (settings.auto_enabled === true && settings.approval_required === true) {
        throw new Error(
          `Cannot enable auto-run when approval is required for agent ${agentId}. ` +
            `Set approval_required=false or auto_enabled=false.`
        );
      }
      // Otherwise, auto-correct by disabling auto when approval is enabled
      if (settings.approval_required === true && current.auto_enabled === true) {
        updated.auto_enabled = false;
      }
    }

    this.settings.set(agentId, updated);
  }

  /**
   * Check if auto-run is enabled for an agent.
   * Returns true only if auto_enabled=true AND approval_required=false.
   * This enforces the constraint: an agent cannot run auto if approval is required.
   *
   * @param agentId The agent ID
   * @returns true if the agent can run automatically
   */
  isAutoEnabled(agentId: AgentId): boolean {
    const setting = this.get(agentId);
    // Only true if both auto_enabled AND NOT approval_required
    return setting.auto_enabled === true && setting.approval_required === false;
  }

  /**
   * Toggle auto-run for an agent.
   * If toggling to true and approval_required=true, throws an error (constraint violation).
   * If toggling to false, always succeeds.
   *
   * @param agentId The agent ID
   * @param enabled The new auto_enabled value
   * @throws Error if trying to enable auto when approval is required
   */
  toggleAuto(agentId: AgentId, enabled: boolean): void {
    if (enabled === true) {
      const current = this.get(agentId);
      if (current.approval_required === true) {
        throw new Error(
          `Cannot enable auto-run when approval is required for agent ${agentId}. ` +
            `Set approval_required=false or auto_enabled=false.`
        );
      }
    }
    this.set(agentId, { auto_enabled: enabled });
  }

  /**
   * Toggle approval requirement for an agent.
   * If toggling to true and auto_enabled=true, disables auto to maintain consistency.
   * This maintains the invariant: approval_required=true implies auto_enabled=false.
   *
   * @param agentId The agent ID
   * @param required The new approval_required value
   */
  toggleApprovalRequired(agentId: AgentId, required: boolean): void {
    const current = this.get(agentId);
    const update: Partial<AgentAutonomySetting> = { approval_required: required };

    // If requiring approval and auto is currently enabled, disable auto
    if (required === true && current.auto_enabled === true) {
      update.auto_enabled = false;
    }

    this.settings.set(agentId, { ...current, ...update, agent_id: agentId });
  }

  /**
   * Toggle notification preference for an agent.
   *
   * @param agentId The agent ID
   * @param notify The new notify_on_change value
   */
  toggleNotifyOnChange(agentId: AgentId, notify: boolean): void {
    this.set(agentId, { notify_on_change: notify });
  }

  /**
   * Get all autonomy settings as a serializable object.
   * Useful for persisting the entire state.
   *
   * @returns Object mapping agent IDs to their settings
   */
  toJSON(): Record<AgentId, AgentAutonomySetting> {
    const result: Record<string, AgentAutonomySetting> = {};
    for (const [agentId, setting] of this.settings.entries()) {
      result[agentId] = JSON.parse(JSON.stringify(setting));
    }
    return result as Record<AgentId, AgentAutonomySetting>;
  }

  /**
   * Check if a string is a valid agent ID.
   *
   * @param id The string to check
   * @returns true if the string is a known agent ID
   */
  private isValidAgentId(id: string): id is AgentId {
    return Object.values(AGENT_IDS).includes(id as AgentId);
  }

  /**
   * Reset all settings to defaults.
   * Useful for testing or user-requested reset.
   */
  resetToDefaults(): void {
    this.settings.clear();
    for (const agentId of Object.values(AGENT_IDS)) {
      this.settings.set(agentId, JSON.parse(JSON.stringify(DEFAULTS[agentId])));
    }
  }

  /**
   * Get all known agent IDs.
   *
   * @returns Array of all supported agent IDs
   */
  getAllAgentIds(): AgentId[] {
    return Object.values(AGENT_IDS) as AgentId[];
  }
}

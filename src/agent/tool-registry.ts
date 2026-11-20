/**
 * WP-4.1 — Tool registry: permission levels, schemas, and per-agent registrations.
 * Each tool has a fixed permission level (R/A/P/X) that the agent cannot change.
 * Each agent gets a fixed tool list defined in the roster.
 */

export type ToolPermissionLevel = "R" | "A" | "P" | "X";

/**
 * Tool definition with permission level and JSON schema.
 */
export interface AgentToolDefinition {
  name: string;
  description: string;
  permissionLevel: ToolPermissionLevel;
  schema: Record<string, unknown>; // JSON Schema
  reversible: boolean; // true for A-level (can undo)
}

/**
 * Central tool registry: all tools and their fixed permission levels.
 * Agents register only their assigned tools; tools not on the list are not available to the agent.
 */
export const TOOL_REGISTRY: Record<string, Omit<AgentToolDefinition, "name">> = {
  // ============ R — Read (run freely) ============

  get_household: {
    description: "Get household info (members, attendance flags, settings)",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
      },
      required: ["household_id"],
    },
  },

  get_member_summary: {
    description:
      "Get member profile (allergies as flags, conditions as flags, diet prefs, activity). No raw health fields.",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
      },
      required: ["member_id"],
    },
  },

  list_recipes: {
    description: "List recipes (paginated, searchable)",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        search: { type: "string" },
        meal_type: { enum: ["breakfast", "lunch", "dinner", "snack"] },
        limit: { type: "number" },
        offset: { type: "number" },
      },
    },
  },

  get_recipe: {
    description: "Get recipe details (title, ingredients, method, nutrition, source)",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        recipe_id: { type: "string" },
      },
      required: ["recipe_id"],
    },
  },

  get_plan: {
    description:
      "Get current meal plan (meals, locks, swaps, history). Returns structured plan data.",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        date_range: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
        },
      },
    },
  },

  get_grocery_list: {
    description: "Get current grocery list (items, quantities, aisle grouping, purchase dates)",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
      },
      required: ["household_id"],
    },
  },

  explain_rules_applied: {
    description:
      "Explain why a specific meal slot has its current recipe (e.g. allergy rules, preference scoring)",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        date: { type: "string" },
        meal_type: { enum: ["breakfast", "lunch", "dinner", "snack"] },
      },
      required: ["plan_id", "date", "meal_type"],
    },
  },

  get_tips: {
    description: "Get clinical-source (HT01) and pool (HT02) tips, filtered by context",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        context: {
          type: "string",
          enum: ["nutrition", "activity", "member_age", "condition"],
        },
        member_id: { type: "string" },
      },
    },
  },

  get_memory: {
    description: "Get preference memory entries (no health facts)",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        member_id: { type: "string" },
      },
    },
  },

  list_outcomes: {
    description: "List meal outcomes for a date range (cooked, skipped, eaten out, swapped)",
    permissionLevel: "R",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        date_range: {
          type: "object",
          properties: {
            from: { type: "string" },
            to: { type: "string" },
          },
        },
      },
    },
  },

  // ============ Team — Coordinator only ============

  delegate: {
    description:
      "Delegate a task to a specialist agent. Returns structured result. Hub-and-spoke only (max depth 1).",
    permissionLevel: "R", // No data change; routes to specialist
    reversible: false,
    schema: {
      type: "object",
      properties: {
        agent: {
          enum: ["setup", "scout", "planner", "grocery", "activity", "reviewer"],
        },
        task_description: { type: "string" },
        inputs: { type: "object" },
      },
      required: ["agent", "task_description"],
    },
  },

  // ============ A — Act, then notify (reversible) ============

  import_recipe_url: {
    description: "Import a single recipe from a URL. Runs parser, creates review if uncertain.",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        household_id: { type: "string" },
      },
      required: ["url", "household_id"],
    },
  },

  draft_plan: {
    description: "Draft a meal plan from preferences. Calls the deterministic planner.",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        start_date: { type: "string" },
        plan_days: { type: "number" },
        preferences: {
          type: "object",
          properties: {
            own_source_ratio: { type: "number" },
            avoid_ingredients: { type: "array", items: { type: "string" } },
            prefer_cuisines: { type: "array", items: { type: "string" } },
          },
        },
      },
      required: ["household_id", "start_date", "plan_days"],
    },
  },

  propose_swap: {
    description: "Propose swapping a meal in the draft plan. Returns a proposal for review.",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        date: { type: "string" },
        meal_type: { enum: ["breakfast", "lunch", "dinner", "snack"] },
        new_recipe_id: { type: "string" },
      },
      required: ["plan_id", "date", "meal_type"],
    },
  },

  reflow_week: {
    description: "Reflow a week after a meal is skipped or moved. Draft only.",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        event: {
          enum: ["meal_skipped", "meal_moved"],
        },
        date: { type: "string" },
        meal_type: { enum: ["breakfast", "lunch", "dinner", "snack"] },
      },
      required: ["plan_id", "event", "date", "meal_type"],
    },
  },

  draft_grocery_list: {
    description: "Draft a merged grocery list from an accepted plan",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        household_id: { type: "string" },
      },
      required: ["plan_id", "household_id"],
    },
  },

  record_meal_outcome: {
    description: "Record that a meal was cooked, skipped, or eaten out (from user statement)",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        date: { type: "string" },
        meal_type: { enum: ["breakfast", "lunch", "dinner", "snack"] },
        outcome: { enum: ["cooked", "skipped", "eaten_out", "modified"] },
      },
      required: ["plan_id", "date", "meal_type", "outcome"],
    },
  },

  record_checkin: {
    description: "Record an activity check-in for a member",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        goal_id: { type: "string" },
        completed: { type: "boolean" },
      },
      required: ["member_id", "goal_id", "completed"],
    },
  },

  write_memory: {
    description:
      "Write a preference memory entry (e.g. 'member X dislikes mushrooms'). Rejects health facts.",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        member_id: { type: "string" },
        type: {
          enum: ["like", "dislike", "weeknight_pattern", "cuisine_pref", "time_constraint"],
        },
        value: { type: "string" },
        source: { type: "string" },
      },
      required: ["household_id", "type", "value"],
    },
  },

  update_scoring_weights: {
    description:
      "Update planner scoring weights (bounded: each 0.5× to 2× of default). Weekly Reviewer only.",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        weight_updates: {
          type: "object",
          additionalProperties: { type: "number" },
        },
      },
      required: ["household_id", "weight_updates"],
    },
  },

  schedule_nudge: {
    description:
      "Schedule a proactive nudge (spoilage suggestion, check-in reminder, etc). Respects quiet hours and daily cap.",
    permissionLevel: "A",
    reversible: true,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        nudge_type: {
          enum: ["spoilage_suggestion", "checkin_reminder", "import_finished"],
        },
        scheduled_for: { type: "string" },
        message: { type: "string" },
      },
      required: ["household_id", "nudge_type"],
    },
  },

  // ============ P — Propose, User approves ============

  create_approval: {
    description: "Create an approval card for a P-level action. Nothing changes until approved.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        proposed_by_agent: { type: "string" },
        tool: { type: "string" },
        summary: { type: "string" },
        diff: { type: "object" },
        expires_in_days: { type: "number" },
      },
      required: ["proposed_by_agent", "tool", "summary"],
    },
  },

  accept_plan: {
    description: "Accept a drafted plan (becomes active). Requires prior approval.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["plan_id", "approval_id"],
    },
  },

  apply_reflow: {
    description: "Apply a reflow draft to the current plan. Requires prior approval.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        plan_id: { type: "string" },
        reflow_draft_id: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["plan_id", "reflow_draft_id", "approval_id"],
    },
  },

  bulk_import_source: {
    description:
      "Bulk import all recipes from a trusted source (blog, channel, etc). Requires approval.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        source_id: { type: "string" },
        household_id: { type: "string" },
        approval_id: { type: "string" },
      },
      required: ["source_id", "household_id", "approval_id"],
    },
  },

  create_or_update_member: {
    description: "Create or update a member profile (from setup chat). Requires review card.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        member_id: { type: "string" },
        updates: { type: "object" },
        approval_id: { type: "string" },
      },
      required: ["household_id", "updates", "approval_id"],
    },
  },

  set_attendance: {
    description: "Set a member's meal attendance (e.g. guest for Saturday dinner)",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        member_id: { type: "string" },
        date: { type: "string" },
        meal_type: { enum: ["breakfast", "lunch", "dinner", "snack"] },
        attending: { type: "boolean" },
        approval_id: { type: "string" },
      },
      required: ["household_id", "member_id", "date", "meal_type", "attending", "approval_id"],
    },
  },

  set_activity_goal: {
    description: "Set an activity goal for a member (HHS guidelines). Requires approval.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        member_id: { type: "string" },
        goal_type: { enum: ["steps", "minutes_moderate", "minutes_vigorous"] },
        target_per_week: { type: "number" },
        approval_id: { type: "string" },
      },
      required: ["member_id", "goal_type", "target_per_week", "approval_id"],
    },
  },

  send_to_instacart: {
    description: "Send an approved grocery list to Instacart (mock or real). Requires approval.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        grocery_list_id: { type: "string" },
        approval_id: { type: "string" },
        mock: { type: "boolean" },
      },
      required: ["grocery_list_id", "approval_id"],
    },
  },

  change_household_settings: {
    description:
      "Change household settings (quiet hours, weekly schedule time, autonomy levels). Requires approval.",
    permissionLevel: "P",
    reversible: false,
    schema: {
      type: "object",
      properties: {
        household_id: { type: "string" },
        updates: { type: "object" },
        approval_id: { type: "string" },
      },
      required: ["household_id", "updates", "approval_id"],
    },
  },

  // ============ X — Never available to agents ============
  // (These are UI-only or deeply restricted)
  // - confirm_allergen_safety
  // - set_allergies_or_conditions
  // - grant_or_withdraw_consent
  // - edit_rules_or_floors
  // - delete_data
  // - change_billing
  // - place_orders
  // - send_external_messages
};

/**
 * Get the tool registry entries for a specific agent.
 * Used during agent initialization to register only its allowed tools.
 */
export function getAgentToolset(agentRole: string): AgentToolDefinition[] {
  const toolsets: Record<string, string[]> = {
    coordinator: [
      "get_household",
      "get_member_summary",
      "get_plan",
      "get_memory",
      "delegate",
      "create_approval",
    ],

    setup: [
      "get_household",
      "get_member_summary",
      "create_or_update_member",
      "set_attendance",
      "change_household_settings",
    ],

    scout: [
      "list_recipes",
      "get_recipe",
      "import_recipe_url",
      "bulk_import_source",
    ],

    planner: [
      "get_plan",
      "list_recipes",
      "get_recipe",
      "explain_rules_applied",
      "draft_plan",
      "propose_swap",
      "reflow_week",
      "accept_plan",
      "apply_reflow",
    ],

    grocery: [
      "get_plan",
      "get_grocery_list",
      "draft_grocery_list",
      "schedule_nudge",
      "send_to_instacart",
    ],

    activity: [
      "get_member_summary",
      "get_tips",
      "record_checkin",
      "set_activity_goal",
      "schedule_nudge",
    ],

    reviewer: [
      "get_plan",
      "get_memory",
      "list_outcomes",
      "write_memory",
      "update_scoring_weights",
    ],

    guardian: [
      "get_household",
      "get_member_summary",
      "get_tips",
      // Guardian returns pass/block/replace, no tools that change data
    ],
  };

  const toolNames = toolsets[agentRole] || [];
  return toolNames
    .map((name) => ({
      name,
      ...(TOOL_REGISTRY[name] || { description: "", permissionLevel: "R" as const, reversible: false, schema: {} }),
    }))
    .filter((t) => t.permissionLevel !== "X") as AgentToolDefinition[];
}

/**
 * Check if an agent can call a tool.
 */
export function canAgentCallTool(agentRole: string, toolName: string): boolean {
  const toolset = getAgentToolset(agentRole);
  return toolset.some((t) => t.name === toolName);
}

/**
 * Get permission level for a tool.
 */
export function getToolPermissionLevel(toolName: string): ToolPermissionLevel {
  return (TOOL_REGISTRY[toolName]?.permissionLevel as ToolPermissionLevel) || "X";
}

/**
 * WP-4.3 — Coordinator Agent: Front door and orchestrator.
 * Routes user requests to specialists via delegate(), merges results into one reply.
 * Creates approval cards for P-level actions (one card per user request).
 * Enforces budget limits across the team and hub-and-spoke architecture.
 */

import type { AgentExecutionContext, DelegationResult, LLMToolCall } from "./runtime";
import { AgentRuntime, LLMClient } from "./runtime";
import { getAgentConfig } from "./roster";
import type { SafetyGuardian } from "./safety-guardian";

/**
 * Specialist task request for delegation.
 */
export interface SpecialistTask {
  agent: "setup" | "scout" | "planner" | "grocery" | "activity" | "reviewer";
  description: string;
  inputs: Record<string, unknown>;
}

/**
 * Rich card types for response formatting.
 */
export type CardType = "plan_diff" | "recipe" | "approval" | "summary" | "message";

export interface RichCard {
  type: CardType;
  title: string;
  content: Record<string, unknown>;
  actionButtons?: Array<{
    label: string;
    action: string; // approve, decline, edit
    actionId: string;
  }>;
}

/**
 * Coordinator response with merged results and cards.
 */
export interface CoordinatorResponse {
  success: boolean;
  message: string; // Main reply text
  cards: RichCard[]; // Rich cards (plan diff, recipe, approval, etc.)
  approvalCard?: {
    id: string;
    summary: string;
    diff: Record<string, unknown>;
    expiresAt: string;
    /** Which tool(s) the decision authorises, e.g. "propose:planner+grocery". */
    tool?: string;
  };
  delegationsSummary?: {
    agentsInvolved: string[];
    tasksCompleted: number;
    tasksSkipped: number;
  };
  budgetStatus?: {
    toolCallsRemaining: number;
    delegationsRemaining: number;
  };
  error?: string;
}

/**
 * Intent routing for coordinator.
 */
export interface UserIntent {
  type:
    | "setup_household"
    | "import_recipes"
    | "plan_meals"
    | "draft_grocery"
    | "ask_tips"
    | "check_schedule"
    | "help";
  summary: string;
  specialists: Array<"setup" | "scout" | "planner" | "grocery" | "activity" | "reviewer">;
  priority: "high" | "normal" | "low";
}

/**
 * Coordinator Agent — orchestrates the specialist team.
 */
export class Coordinator {
  private llm: LLMClient;
  private config = getAgentConfig("coordinator");
  private delegationResults: Array<{
    task: SpecialistTask;
    result: DelegationResult;
  }> = [];

  constructor(
    private context: AgentExecutionContext,
    private runtime: AgentRuntime,
    private guardian: SafetyGuardian,
  ) {
    this.llm = new LLMClient(this.config.model);
  }

  /**
   * Main orchestration method: receive user request, route to specialists, merge results.
   */
  async handleUserRequest(userMessage: string): Promise<CoordinatorResponse> {
    try {
      // 1. Safety check: let Guardian screen input
      const guardianCheck = await this.guardian.checkInputMessage(
        `msg-${Date.now()}`,
        userMessage,
        [], // TODO: pass real household members
      );

      if (guardianCheck.decision === "block") {
        return {
          success: false,
          message: `I can't help with that. ${guardianCheck.reason}`,
          cards: [],
          error: guardianCheck.reason,
        };
      }

      // 2. Understand intent
      const intent = await this.classifyIntent(userMessage);

      const results: DelegationResult[] = [];

      if (intent.type !== "help") {
        // 3. Check budget before delegating. A help answer costs no delegation,
        // so it is not gated here — it still has to reach the output guard below.
        const budgetStatus = this.runtime.getBudgetStatus(this.context);
        if (budgetStatus.delegationsRemaining <= 0) {
          return {
            success: false,
            message: "I've used my delegation budget this turn. Let me summarize what we've done so far.",
            cards: [],
            budgetStatus,
            delegationsSummary: {
              agentsInvolved: [],
              tasksCompleted: 0,
              tasksSkipped: 0,
            },
            error: "Budget exhausted",
          };
        }

        // 4. Delegate to specialists
        const delegationTasks = this.buildDelegationTasks(intent, userMessage);

        for (const task of delegationTasks) {
          const budgetCheck = this.runtime.getBudgetStatus(this.context);
          if (budgetCheck.delegationsRemaining <= 0) {
            break; // Stop delegating if out of budget
          }

          const result = await this.delegateToSpecialist(task);
          if (result) {
            results.push(result);
            this.delegationResults.push({ task, result });
          }
        }
      }

      // 5. Merge results into one response. Help answers merge zero delegations
      // but take the same path: every user-visible message is guarded and shaped
      // identically, which the early return used to skip.
      const merged =
        intent.type === "help"
          ? this.respondToHelp(userMessage)
          : this.mergeSpecialistResults(results, intent);

      if (intent.type === "help") {
        merged.delegationsSummary = {
          agentsInvolved: [],
          tasksCompleted: 0,
          tasksSkipped: 0,
        };
      }

      // 6. Create approval card if needed (one per request)
      if (results.length > 0 && this.shouldCreateApprovalCard(results)) {
        merged.approvalCard = this.createApprovalCard(results);
      }

      // 7. Safety check: let Guardian review output
      const outputCheck = await this.guardian.checkOutputMessage(
        `msg-${Date.now()}`,
        merged.message,
        [], // TODO: pass real household members
      );

      if (outputCheck.decision === "replace") {
        merged.message = `[Message safety check] ${outputCheck.reason}`;
      }

      // 8. Return merged response
      return merged;
    } catch (error) {
      return {
        success: false,
        message: `An error occurred: ${error instanceof Error ? error.message : String(error)}`,
        cards: [],
        error: String(error),
      };
    }
  }

  /**
   * Classify user intent using LLM.
   */
  /**
   * Deterministic request routing (AG01).
   *
   * This used to ask an LLM to classify the message and, on ANY failure, silently
   * return the "help" intent — so without an API key every real request ("plan
   * meals for next week") answered with a topic list and no delegation. Routing is
   * now pure pattern matching: reproducible, free, and testable without network.
   *
   * One message can raise several intents ("plan meals and import recipes"); all
   * of them are unioned into one delegation set, because the Coordinator still
   * merges every specialist proposal into a single approval card.
   */
  private static readonly INTENT_RULES: ReadonlyArray<{
    type: UserIntent["type"];
    specialists: UserIntent["specialists"];
    priority: UserIntent["priority"];
    test: RegExp;
  }> = [
    {
      type: "setup_household",
      specialists: ["setup"],
      priority: "high",
      test: /\b(allerg\w*|member|members|kid|kids|child|children|son|daughter|household|onboard\w*|set\s*up|gluten|vegan|vegetarian|diabet\w*|kidney|hypertension|cholesterol|celiac|pregnan\w*)\b/i,
    },
    {
      type: "import_recipes",
      specialists: ["scout"],
      priority: "normal",
      test: /\b(import\w*|recipe|recipes|blog|link|url)\b|https?:\/\//i,
    },
    {
      type: "plan_meals",
      specialists: ["planner", "grocery"],
      priority: "high",
      test: /\b(plan|plans|meal|meals|dinner|lunch|breakfast|reflow|swap)\b/i,
    },
    {
      type: "draft_grocery",
      specialists: ["grocery"],
      priority: "normal",
      test: /\b(grocer\w*|shopping|shop)\b/i,
    },
    {
      type: "check_schedule",
      specialists: ["planner"],
      priority: "normal",
      test: /\b(schedule|calendar|tonight|tomorrow)\b|what'?s\s+(on|for)/i,
    },
    {
      type: "ask_tips",
      specialists: ["activity"],
      priority: "low",
      test: /\b(tip|tips|advice|activity|exercise|nutri\w*|goal|goals)\b/i,
    },
  ];

  private async classifyIntent(message: string): Promise<UserIntent> {
    const matched = Coordinator.INTENT_RULES.filter((rule) => rule.test.test(message));

    // Nothing recognisable: answer with help rather than inventing a delegation.
    if (matched.length === 0) {
      return { type: "help", summary: message, specialists: [], priority: "low" };
    }

    const rank = { high: 0, normal: 1, low: 2 } as const;
    const primary = matched.reduce((best, rule) =>
      rank[rule.priority] < rank[best.priority] ? rule : best,
    );

    const specialists: UserIntent["specialists"] = [];
    for (const rule of matched) {
      for (const agent of rule.specialists) {
        if (!specialists.includes(agent)) specialists.push(agent);
      }
    }

    return {
      type: primary.type,
      summary: message,
      specialists,
      priority: primary.priority,
    };
  }
  /**
   * Build specialist delegation tasks from intent.
   */
  private buildDelegationTasks(intent: UserIntent, userMessage: string): SpecialistTask[] {
    const tasks: SpecialistTask[] = [];

    for (const specialist of intent.specialists) {
      tasks.push({
        agent: specialist,
        description: intent.summary,
        inputs: { userMessage },
      });
    }

    return tasks;
  }

  /**
   * Delegate a task to a specialist and track budget.
   */
  private async delegateToSpecialist(task: SpecialistTask): Promise<DelegationResult | null> {
    // Record delegation in budget
    const budgetCheck = this.runtime.recordDelegation(this.context, task.agent);
    if (!budgetCheck.allowed) {
      console.warn(`Cannot delegate to ${task.agent}: ${budgetCheck.reason}`);
      return null;
    }

    // In real implementation, this would call the specialist agent
    // For now, return a mock result
    const result: DelegationResult = {
      success: true,
      agentRole: task.agent,
      taskSummary: task.description,
      output: {
        status: `${task.agent} processed request`,
        details: "Mock specialist response",
      },
      toolsCalled: 2,
      tokensUsed: 200,
    };

    this.runtime.recordTokens(this.context, result.tokensUsed);
    return result;
  }

  /**
   * Merge specialist results into one coordinator response.
   * One approval card per user request (not one per specialist).
   */
  private mergeSpecialistResults(results: DelegationResult[], intent: UserIntent): CoordinatorResponse {
    const agentsInvolved = [...new Set(results.map((r) => r.agentRole))];
    const messages: string[] = [];
    const cards: RichCard[] = [];

    for (const result of results) {
      if (result.success) {
        messages.push(`✓ ${result.agentRole}: ${result.taskSummary}`);
      } else {
        messages.push(`✗ ${result.agentRole}: ${result.error}`);
      }
    }

    // Create one summary message
    const mainMessage =
      intent.type === "plan_meals"
        ? `I've drafted your meal plan and grocery list. Ready to review?`
        : intent.type === "import_recipes"
          ? `I've processed ${results.length} recipe import(s). Here's what came in.`
          : `I've updated your household. Here's a summary:`;

    return {
      success: results.every((r) => r.success),
      message: mainMessage,
      cards,
      delegationsSummary: {
        agentsInvolved,
        tasksCompleted: results.filter((r) => r.success).length,
        tasksSkipped: results.filter((r) => !r.success).length,
      },
      budgetStatus: this.runtime.getBudgetStatus(this.context),
    };
  }

  /**
   * Determine if we should create an approval card (P-level actions).
   */
  private shouldCreateApprovalCard(results: DelegationResult[]): boolean {
    // Create approval card if any specialist returned a P-level proposal
    return results.length > 0 && results.some((r) => r.output && typeof r.output === "object");
  }

  /**
   * Create a single approval card merging all specialist proposals.
   */
  private createApprovalCard(
    results: DelegationResult[],
  ): CoordinatorResponse["approvalCard"] {
    const diffs: Record<string, unknown> = {};

    // Merge diffs from all specialists into one card
    for (const result of results) {
      if (result.output && typeof result.output === "object") {
        const output = result.output as Record<string, unknown>;
        if (output.diff) {
          Object.assign(diffs, output.diff);
        }
      }
    }

    const roles = [...new Set(results.map((r) => r.agentRole))].sort();
    return {
      id: `approval-${Date.now()}`,
      summary: `Plan and grocery list (from ${results.map((r) => r.agentRole).join(", ")})`,
      diff: diffs,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
      tool: `propose:${roles.join("+")}`,
    };
  }

  /**
   * Handle help/general questions without delegating.
   */
  private respondToHelp(message: string): CoordinatorResponse {
    const helpTopics: Record<string, string> = {
      allergies: "Allergies are hard filters — meals never include restricted items.",
      meals: "I can help you plan meals, swap recipes, or import your favorite recipes.",
      energy: "I ensure everyone gets balanced nutrition based on their age and activity.",
      budget: "I'm powered by specialist agents. Each request might delegate to different experts.",
    };

    const response = Object.entries(helpTopics)
      .map(([key, value]) => `• ${key}: ${value}`)
      .join("\n");

    return {
      success: true,
      message: `Here's what I can help with:\n${response}`,
      cards: [],
      // Callers read the budget on every turn, help included: the UI dims the
      // composer from this number, and a missing budgetStatus read as "unlimited".
      budgetStatus: this.runtime.getBudgetStatus(this.context),
    };
  }

  /**
   * Run the scheduled weekly cycle (AG02).
   * Reviewer → Planner → Grocery → approval card.
   */
  async runWeeklySchedule(): Promise<CoordinatorResponse> {
    console.log("Running scheduled weekly cycle...");

    // 1. Weekly Reviewer runs first
    const reviewerResult = await this.delegateToSpecialist({
      agent: "reviewer",
      description: "Review last week's outcomes and update preferences",
      inputs: { lookback_days: 7 },
    });

    if (!reviewerResult || !reviewerResult.success) {
      return {
        success: false,
        message: "Weekly review failed",
        cards: [],
      };
    }

    // 2. Meal Planner drafts plan
    const plannerResult = await this.delegateToSpecialist({
      agent: "planner",
      description: "Draft next week's meal plan",
      inputs: { days: 7 },
    });

    // 3. Grocery drafts list
    const groceryResult = await this.delegateToSpecialist({
      agent: "grocery",
      description: "Draft grocery list from plan",
      inputs: {},
    });

    // 4. Merge and create approval
    const results = [reviewerResult, plannerResult, groceryResult].filter((r) => r !== null) as DelegationResult[];
    const merged = this.mergeSpecialistResults(results, {
      type: "plan_meals",
      summary: "Weekly planning cycle",
      specialists: ["reviewer", "planner", "grocery"],
      priority: "high",
    });

    merged.approvalCard = this.createApprovalCard(results);
    merged.message = "Next week's plan and grocery list are ready for review.";

    return merged;
  }

  /**
   * Handle event-driven reflow (meal skipped, etc.).
   */
  async handleMealSkipped(date: string, mealType: string): Promise<CoordinatorResponse> {
    console.log(`Handling meal skipped: ${date} ${mealType}`);

    // Delegate to planner for reflow
    const reflowResult = await this.delegateToSpecialist({
      agent: "planner",
      description: `Reflow week after ${mealType} skipped on ${date}`,
      inputs: { date, mealType, event: "meal_skipped" },
    });

    if (!reflowResult) {
      return {
        success: false,
        message: "Reflow failed",
        cards: [],
      };
    }

    // Check for spoilage nudges from grocery
    const groceryResult = await this.delegateToSpecialist({
      agent: "grocery",
      description: "Check for spoilage alerts after reflow",
      inputs: { date },
    });

    const results = [reflowResult, groceryResult].filter((r) => r !== null) as DelegationResult[];
    return this.mergeSpecialistResults(results, {
      type: "plan_meals",
      summary: "Reflow after meal skipped",
      specialists: ["planner", "grocery"],
      priority: "high",
    });
  }

  /**
   * Get delegation history for logging.
   */
  getDelegationHistory(): Array<{ task: SpecialistTask; result: DelegationResult }> {
    return this.delegationResults;
  }

  /**
   * Get current budget status.
   */
  getBudgetStatus() {
    return this.runtime.getBudgetStatus(this.context);
  }
}

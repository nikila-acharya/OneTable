/**
 * WP-4.1 — Multi-agent runtime: LLMClient, execution context, delegation, limits and budget tracking.
 * Provides the core infrastructure for the seven-agent team.
 * Hub-and-spoke only: Coordinator delegates to specialists via delegate(), max 4 delegations per run.
 * Budget: max 25 tool calls per run, max 3 planner calls per user turn.
 */

import type { AgentToolDefinition, ToolPermissionLevel } from "./tool-registry";

export type AgentRole =
  | "coordinator"
  | "setup"
  | "scout"
  | "planner"
  | "grocery"
  | "activity"
  | "reviewer"
  | "guardian";

export type RunMode = "conversational" | "scheduled" | "event";
export type RunTrigger = "user_message" | "scheduled_weekly" | "meal_skipped" | "import_finished" | "spoilage_alert" | "checkin_due";

/**
 * Result of a delegated task — returned to Coordinator.
 */
export interface DelegationResult {
  success: boolean;
  agentRole: AgentRole;
  taskSummary: string;
  output?: unknown; // Structured result (plan, draft, etc.)
  error?: string;
  toolsCalled: number;
  tokensUsed: number;
}

/**
 * Runtime budget and limits tracking per run.
 */
export interface RuntimeBudget {
  maxToolCalls: number; // 25 per run
  maxDelegations: number; // 4 per run
  maxPlannerCalls: number; // 3 per user turn
  maxTokensPerRun: number; // Per tier, per household

  toolCallsUsed: number;
  delegationsUsed: number;
  plannerCallsThisTurn: number;
  tokensUsed: number;
}

/**
 * Execution context passed to each agent.
 */
export interface AgentExecutionContext {
  runId: string;
  mode: RunMode;
  trigger: RunTrigger;
  householdId: string;
  userId: string;
  timestamp: string; // ISO

  // Current run's budget
  budget: RuntimeBudget;

  // Memory and data accessors (read-only passed to agents via tools)
  memory: Record<string, unknown>;
  household: Record<string, unknown>;

  // Parent run tracking (for delegations)
  parentRunId?: string;
  delegationDepth: number;
}

/**
 * LLM provider configuration.
 */
export interface LLMProviderConfig {
  provider: "openrouter" | "openai" | "anthropic"; // env-configurable
  model: string; // e.g., "anthropic/claude-3.5-sonnet"
  temperature?: number;
  maxTokens?: number;
}

const PROVIDERS: readonly LLMProviderConfig["provider"][] = [
  "openrouter",
  "openai",
  "anthropic",
];

/**
 * Resolve the configured provider from the environment.
 *
 * Replaces eight `process.env.AGENT_LLM_PROVIDER as any` casts. A cast let a
 * typo'd value through as a valid provider, so the request would fail at call
 * time with an opaque error; anything unrecognised now falls back to the default.
 */
export function resolveProvider(envValue?: string): LLMProviderConfig["provider"] {
  return PROVIDERS.includes(envValue as LLMProviderConfig["provider"])
    ? (envValue as LLMProviderConfig["provider"])
    : "openrouter";
}

/**
 * Native tool call from LLM (structured, not tool_use wrapper).
 */
export interface LLMToolCall {
  toolName: string;
  arguments: Record<string, unknown>;
}

/**
 * LLM message in conversation.
 */
export interface LLMMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * LLMClient — Provider-agnostic client with native tool calling.
 * Handles OpenRouter, OpenAI, Anthropic with consistent interface.
 */
export class LLMClient {
  private provider: LLMProviderConfig;
  private conversationHistory: LLMMessage[] = [];

  constructor(config?: Partial<LLMProviderConfig>) {
    this.provider = {
      provider: resolveProvider(process.env.AGENT_LLM_PROVIDER),
      model: process.env.AGENT_LLM_MODEL || "anthropic/claude-3.5-sonnet",
      temperature: 0.7,
      maxTokens: 2000,
      ...config,
    };
  }

  /**
   * Call LLM with tool definitions; returns text or tool calls.
   * Provider-agnostic interface normalizes native tool calling across OpenRouter/OpenAI/Anthropic.
   */
  async callWithTools(
    systemPrompt: string,
    userMessage: string,
    tools: AgentToolDefinition[],
  ): Promise<{
    text: string;
    toolCalls: LLMToolCall[];
    inputTokens: number;
    outputTokens: number;
  }> {
    // Add to conversation history
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    // Build provider-specific request
    const request = this.buildRequest(systemPrompt, tools);

    try {
      // Call provider
      const response = await this.callProvider(request);

      // Parse response (provider-specific)
      const { text, toolCalls, tokens } = this.parseResponse(response);

      // Track conversation
      if (text) {
        this.conversationHistory.push({
          role: "assistant",
          content: text,
        });
      }

      return {
        text,
        toolCalls,
        inputTokens: tokens.input,
        outputTokens: tokens.output,
      };
    } catch (error) {
      throw new Error(
        `LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Reset conversation history (for new tasks).
   */
  resetHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Get current conversation history (read-only).
   */
  getHistory(): readonly LLMMessage[] {
    return Object.freeze([...this.conversationHistory]);
  }

  /**
   * Build provider-specific request format.
   */
  private buildRequest(
    systemPrompt: string,
    tools: AgentToolDefinition[],
  ): unknown {
    switch (this.provider.provider) {
      case "openrouter":
      case "openai":
        return {
          model: this.provider.model,
          system: systemPrompt,
          messages: this.conversationHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          tools: tools.map((t) => ({
            type: "function",
            function: {
              name: t.name,
              description: t.description,
              parameters: t.schema,
            },
          })),
          tool_choice: "auto",
          temperature: this.provider.temperature,
          max_tokens: this.provider.maxTokens,
        };

      case "anthropic":
        return {
          model: this.provider.model,
          system: systemPrompt,
          messages: this.conversationHistory.map((m) => ({
            role: m.role,
            content: m.content,
          })),
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            input_schema: t.schema,
          })),
          temperature: this.provider.temperature,
          max_tokens: this.provider.maxTokens,
        };

      default:
        throw new Error(`Unsupported provider: ${this.provider.provider}`);
    }
  }

  /**
   * Call the appropriate provider API.
   */
  private async callProvider(request: unknown): Promise<unknown> {
    // This is a stub — real implementation calls the provider's API
    // In production, use openai, @anthropic-sdk, or fetch for openrouter
    const apiKey = process.env.LLM_API_KEY;
    if (!apiKey) {
      throw new Error("LLM_API_KEY not configured");
    }

    // Stub response for now
    return {
      choices: [
        {
          message: {
            content: "Agent response",
            tool_calls: [],
          },
          finish_reason: "end_turn",
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
      },
    };
  }

  /**
   * Parse provider-specific response into unified format.
   */
  private parseResponse(response: unknown): {
    text: string;
    toolCalls: LLMToolCall[];
    tokens: { input: number; output: number };
  } {
    // Stub parser — real implementation handles provider-specific formats
    return {
      text: "Parsed response",
      toolCalls: [],
      tokens: { input: 100, output: 50 },
    };
  }
}

/**
 * Agent runtime — orchestrates execution with delegation, budget tracking, and limits.
 */
export class AgentRuntime {
  private budget: RuntimeBudget;

  constructor(private householdId: string, private tier: "free" | "household") {
    this.budget = {
      maxToolCalls: 25,
      maxDelegations: 4,
      maxPlannerCalls: 3,
      maxTokensPerRun: this.getTokenBudgetForTier(tier),
      toolCallsUsed: 0,
      delegationsUsed: 0,
      plannerCallsThisTurn: 0,
      tokensUsed: 0,
    };
  }

  /**
   * Create execution context for an agent.
   */
  createContext(
    runId: string,
    mode: RunMode,
    trigger: RunTrigger,
    userId: string,
    parentRunId?: string,
  ): AgentExecutionContext {
    return {
      runId,
      mode,
      trigger,
      householdId: this.householdId,
      userId,
      timestamp: new Date().toISOString(),
      budget: { ...this.budget },
      memory: {}, // Populated by caller (read from DB)
      household: {}, // Populated by caller
      parentRunId,
      delegationDepth: parentRunId ? 1 : 0,
    };
  }

  /**
   * Record a tool call and check budget.
   */
  recordToolCall(
    context: AgentExecutionContext,
    toolName: string,
    isPlannerCall: boolean = false,
  ): { allowed: boolean; reason?: string } {
    if (context.budget.toolCallsUsed >= context.budget.maxToolCalls) {
      return { allowed: false, reason: "Max tool calls per run exceeded" };
    }

    if (isPlannerCall) {
      if (context.budget.plannerCallsThisTurn >= context.budget.maxPlannerCalls) {
        return { allowed: false, reason: "Max planner calls per turn exceeded" };
      }
      context.budget.plannerCallsThisTurn++;
    }

    context.budget.toolCallsUsed++;
    return { allowed: true };
  }

  /**
   * Record a delegation and check budget.
   */
  recordDelegation(
    context: AgentExecutionContext,
    targetAgent: AgentRole,
  ): { allowed: boolean; reason?: string } {
    if (context.budget.delegationsUsed >= context.budget.maxDelegations) {
      return { allowed: false, reason: "Max delegations per run exceeded" };
    }

    if (context.delegationDepth >= 1) {
      return {
        allowed: false,
        reason: "Max delegation depth is 1 (hub-and-spoke only)",
      };
    }

    context.budget.delegationsUsed++;
    return { allowed: true };
  }

  /**
   * Record token usage.
   */
  recordTokens(context: AgentExecutionContext, tokens: number): void {
    context.budget.tokensUsed += tokens;
  }

  /**
   * Check if budget is exhausted.
   */
  isBudgetExhausted(context: AgentExecutionContext): boolean {
    return (
      context.budget.toolCallsUsed >= context.budget.maxToolCalls ||
      context.budget.tokensUsed >= context.budget.maxTokensPerRun
    );
  }

  /**
   * Get budget status.
   */
  getBudgetStatus(context: AgentExecutionContext): {
    toolCallsRemaining: number;
    delegationsRemaining: number;
    plannerCallsRemaining: number;
    tokensRemaining: number;
  } {
    return {
      toolCallsRemaining: context.budget.maxToolCalls - context.budget.toolCallsUsed,
      delegationsRemaining: context.budget.maxDelegations - context.budget.delegationsUsed,
      plannerCallsRemaining: context.budget.maxPlannerCalls - context.budget.plannerCallsThisTurn,
      tokensRemaining: context.budget.maxTokensPerRun - context.budget.tokensUsed,
    };
  }

  /**
   * Token budget per tier (per run).
   */
  private getTokenBudgetForTier(tier: "free" | "household"): number {
    return tier === "free" ? 15000 : 50000;
  }
}

/**
 * Action log entry (for AG05 approval inbox, action log, undo).
 */
export interface ActionLogEntry {
  id: string;
  runId: string;
  timestamp: string;
  agentRole: AgentRole;
  tool: string;
  permissionLevel: ToolPermissionLevel;
  inputsSummary: string;
  resultSummary: string;
  tokensUsed: number;
  undoable: boolean; // true for A-level
  undoneAt?: string;
}

/**
 * Approval card (for P-level tools).
 */
export interface ApprovalCard {
  id: string;
  createdAt: string;
  expiresAt: string; // 7 days
  householdId: string;
  proposedBy: AgentRole;
  tool: string;
  summary: string; // Plain text summary
  diff?: Record<string, unknown>; // Before/after
  approvedAt?: string;
  declinedAt?: string;
  declineReason?: string;
}

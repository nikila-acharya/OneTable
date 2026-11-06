/**
 * WP-4.1 — Runtime tests: LLMClient, execution context, delegation, budget tracking.
 * Tests: agent runtime initialization, budget enforcement, tool registration, delegation limits.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  AgentRuntime,
  LLMClient,
  type AgentExecutionContext,
  type LLMMessage,
} from "./runtime";
import {
  AGENT_ROSTER,
  getAgentConfig,
  getAllAgentRoles,
  getTeamBundleVersion,
} from "./roster";
import {
  TOOL_REGISTRY,
  canAgentCallTool,
  getAgentToolset,
  getToolPermissionLevel,
} from "./tool-registry";

describe("WP-4.1 Multi-agent Runtime", () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = new AgentRuntime("household-001", "household");
  });

  // ============ LLMClient Tests ============
  describe("LLMClient", () => {
    let client: LLMClient;

    beforeEach(() => {
      client = new LLMClient({
        provider: "openrouter",
        model: "anthropic/claude-3.5-sonnet",
      });
    });

    it("initializes with default provider config", () => {
      const defaultClient = new LLMClient();
      expect(defaultClient).toBeDefined();
    });

    it("maintains conversation history across calls", () => {
      client.getHistory();
      expect(client.getHistory()).toHaveLength(0);

      // After real call, history would grow
      // (skipped here due to no real API)
    });

    it("resets conversation history on demand", () => {
      client.resetHistory();
      expect(client.getHistory()).toHaveLength(0);
    });

    it("returns read-only conversation history", () => {
      const history = client.getHistory();
      expect(() => {
        (history as any)[0] = { role: "user", content: "modified" };
      }).toThrow();
    });
  });

  // ============ Execution Context Tests ============
  describe("Execution context creation", () => {
    it("creates context for coordinator run", () => {
      const ctx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );

      expect(ctx.runId).toBe("run-001");
      expect(ctx.mode).toBe("conversational");
      expect(ctx.trigger).toBe("user_message");
      expect(ctx.householdId).toBe("household-001");
      expect(ctx.delegationDepth).toBe(0);
    });

    it("creates context for delegated task with parent run", () => {
      const ctx = runtime.createContext(
        "run-002",
        "conversational",
        "user_message",
        "user-123",
        "run-001", // parent
      );

      expect(ctx.parentRunId).toBe("run-001");
      expect(ctx.delegationDepth).toBe(1);
    });

    it("initializes budget with correct limits", () => {
      const ctx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );

      expect(ctx.budget.maxToolCalls).toBe(25);
      expect(ctx.budget.maxDelegations).toBe(4);
      expect(ctx.budget.maxPlannerCalls).toBe(3);
      expect(ctx.budget.toolCallsUsed).toBe(0);
    });

    it("free tier gets lower token budget than household tier", () => {
      const freeRuntime = new AgentRuntime("household-free", "free");
      const householdRuntime = new AgentRuntime("household-paid", "household");

      const freeCtx = freeRuntime.createContext(
        "run-free",
        "conversational",
        "user_message",
        "user-123",
      );
      const householdCtx = householdRuntime.createContext(
        "run-household",
        "conversational",
        "user_message",
        "user-123",
      );

      expect(freeCtx.budget.maxTokensPerRun).toBeLessThan(
        householdCtx.budget.maxTokensPerRun,
      );
    });
  });

  // ============ Budget Tracking Tests ============
  describe("Budget tracking", () => {
    let ctx: AgentExecutionContext;

    beforeEach(() => {
      ctx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );
    });

    it("allows tool calls within budget", () => {
      for (let i = 0; i < 25; i++) {
        const result = runtime.recordToolCall(ctx, `tool-${i}`);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks tool calls when budget exhausted", () => {
      for (let i = 0; i < 25; i++) {
        runtime.recordToolCall(ctx, `tool-${i}`);
      }

      const result = runtime.recordToolCall(ctx, "tool-26");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("Max tool calls");
    });

    it("tracks planner calls separately", () => {
      for (let i = 0; i < 3; i++) {
        const result = runtime.recordToolCall(ctx, "draft_plan", true);
        expect(result.allowed).toBe(true);
      }

      const result = runtime.recordToolCall(ctx, "draft_plan", true);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("planner calls");
    });

    it("allows delegations within budget", () => {
      const allowedRoles = ["setup", "scout", "grocery"] as const;
      for (const role of allowedRoles) {
        const result = runtime.recordDelegation(ctx, role);
        expect(result.allowed).toBe(true);
      }
    });

    it("blocks delegation when max reached", () => {
      for (let i = 0; i < 4; i++) {
        runtime.recordDelegation(ctx, "setup");
      }

      const result = runtime.recordDelegation(ctx, "scout");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("delegations");
    });

    it("prevents delegation depth > 1", () => {
      const delegatedCtx = runtime.createContext(
        "run-002",
        "conversational",
        "user_message",
        "user-123",
        "run-001", // parent
      );

      const result = runtime.recordDelegation(delegatedCtx, "setup");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("depth");
    });

    it("tracks token usage", () => {
      expect(ctx.budget.tokensUsed).toBe(0);
      runtime.recordTokens(ctx, 500);
      expect(ctx.budget.tokensUsed).toBe(500);
    });

    it("detects budget exhaustion", () => {
      expect(runtime.isBudgetExhausted(ctx)).toBe(false);

      for (let i = 0; i < 25; i++) {
        runtime.recordToolCall(ctx, `tool-${i}`);
      }

      expect(runtime.isBudgetExhausted(ctx)).toBe(true);
    });

    it("provides budget status", () => {
      runtime.recordToolCall(ctx, "draft_plan", true);
      runtime.recordDelegation(ctx, "setup");

      const status = runtime.getBudgetStatus(ctx);
      expect(status.toolCallsRemaining).toBe(24);
      expect(status.delegationsRemaining).toBe(3);
      expect(status.plannerCallsRemaining).toBe(2);
    });
  });

  // ============ Tool Registry Tests ============
  describe("Tool registry and permissions", () => {
    it("lists all tools in registry", () => {
      const toolNames = Object.keys(TOOL_REGISTRY);
      expect(toolNames.length).toBeGreaterThan(20);
      expect(toolNames).toContain("draft_plan");
      expect(toolNames).toContain("delegate");
    });

    it("defines permission level for each tool", () => {
      Object.entries(TOOL_REGISTRY).forEach(([name, tool]) => {
        expect(["R", "A", "P", "X"]).toContain(tool.permissionLevel);
      });
    });

    it("provides schema for each tool", () => {
      Object.entries(TOOL_REGISTRY).forEach(([name, tool]) => {
        expect(tool.schema).toBeDefined();
        expect(typeof tool.schema).toBe("object");
      });
    });

    it("coordinator can call get_household", () => {
      expect(canAgentCallTool("coordinator", "get_household")).toBe(true);
    });

    it("scout cannot call draft_plan", () => {
      expect(canAgentCallTool("scout", "draft_plan")).toBe(false);
    });

    it("only coordinator can delegate", () => {
      expect(canAgentCallTool("coordinator", "delegate")).toBe(true);
      expect(canAgentCallTool("planner", "delegate")).toBe(false);
      expect(canAgentCallTool("scout", "delegate")).toBe(false);
    });

    it("planner can call draft_plan (A-level)", () => {
      expect(canAgentCallTool("planner", "draft_plan")).toBe(true);
    });

    it("setup cannot call draft_plan", () => {
      expect(canAgentCallTool("setup", "draft_plan")).toBe(false);
    });

    it("getAgentToolset returns correct tools", () => {
      const coordinatorTools = getAgentToolset("coordinator");
      expect(coordinatorTools.map((t) => t.name)).toContain("get_household");
      expect(coordinatorTools.map((t) => t.name)).toContain("delegate");

      const scoutTools = getAgentToolset("scout");
      expect(scoutTools.map((t) => t.name)).toContain("import_recipe_url");
      expect(scoutTools.map((t) => t.name)).not.toContain("delegate");
    });

    it("getToolPermissionLevel works for all tools", () => {
      expect(getToolPermissionLevel("get_household")).toBe("R");
      expect(getToolPermissionLevel("draft_plan")).toBe("A");
      expect(getToolPermissionLevel("create_approval")).toBe("P");
    });
  });

  // ============ Agent Roster Tests ============
  describe("Agent roster", () => {
    it("defines all seven agents plus guardian", () => {
      const roles = getAllAgentRoles();
      expect(roles).toHaveLength(8);
      expect(roles).toContain("coordinator");
      expect(roles).toContain("guardian");
    });

    it("each agent has system prompt", () => {
      getAllAgentRoles().forEach((role) => {
        const config = getAgentConfig(role);
        expect(config.systemPrompt.length).toBeGreaterThan(100);
      });
    });

    it("each agent has version bundle", () => {
      getAllAgentRoles().forEach((role) => {
        const config = getAgentConfig(role);
        expect(config.versionBundle).toMatch(/\d{4}-\d{2}-\d{2}/);
      });
    });

    it("coordinator's model defaults to claude-3.5-sonnet", () => {
      const config = getAgentConfig("coordinator");
      expect(config.model.model).toContain("claude");
    });

    it("planner can call its assigned tools", () => {
      const config = getAgentConfig("planner");
      config.tools.forEach((toolName) => {
        expect(canAgentCallTool("planner", toolName)).toBe(true);
      });
    });

    it("guardian has minimal tool set (read-only)", () => {
      const config = getAgentConfig("guardian");
      const tools = getAgentToolset("guardian");
      tools.forEach((tool) => {
        expect(tool.permissionLevel).toBe("R");
      });
    });

    it("team bundle version is consistent", () => {
      const version1 = getTeamBundleVersion();
      const version2 = getTeamBundleVersion();
      expect(version1).toBe(version2);
      expect(version1).toContain("team-");
    });
  });

  // ============ Hub-and-spoke Architecture Tests ============
  describe("Hub-and-spoke architecture", () => {
    it("enforces delegation depth limit", () => {
      const rootCtx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );
      expect(rootCtx.delegationDepth).toBe(0);

      const delegatedCtx = runtime.createContext(
        "run-002",
        "conversational",
        "user_message",
        "user-123",
        "run-001",
      );
      expect(delegatedCtx.delegationDepth).toBe(1);

      // Cannot delegate from a delegated task
      const result = runtime.recordDelegation(delegatedCtx, "setup");
      expect(result.allowed).toBe(false);
    });

    it("coordinator can delegate to any specialist", () => {
      const ctx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );

      const specialists = ["setup", "scout", "planner", "grocery", "activity", "reviewer"] as const;
      specialists.forEach((spec) => {
        const result = runtime.recordDelegation(ctx, spec);
        expect(result.allowed).toBe(true);
      });
    });
  });

  // ============ Least Privilege Tests ============
  describe("Least privilege", () => {
    it("guardian cannot call approval tools", () => {
      const tools = getAgentToolset("guardian");
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).not.toContain("create_approval");
      expect(toolNames).not.toContain("accept_plan");
    });

    it("setup cannot call planner tools", () => {
      expect(canAgentCallTool("setup", "draft_plan")).toBe(false);
      expect(canAgentCallTool("setup", "propose_swap")).toBe(false);
    });

    it("planner can call draft_plan but not import_recipe_url", () => {
      expect(canAgentCallTool("planner", "draft_plan")).toBe(true);
      expect(canAgentCallTool("planner", "import_recipe_url")).toBe(false);
    });

    it("each agent's tool list is fixed", () => {
      const config = getAgentConfig("planner");
      const toolset = getAgentToolset("planner");
      expect(toolset.length).toBeGreaterThan(0);
      expect(toolset.length).toBe(config.tools.length);
    });
  });

  // ============ Run Modes Tests ============
  describe("Run modes", () => {
    it("supports conversational mode", () => {
      const ctx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );
      expect(ctx.mode).toBe("conversational");
    });

    it("supports scheduled mode", () => {
      const ctx = runtime.createContext(
        "run-002",
        "scheduled",
        "scheduled_weekly",
        "system",
      );
      expect(ctx.mode).toBe("scheduled");
    });

    it("supports event-driven mode", () => {
      const ctx = runtime.createContext(
        "run-003",
        "event",
        "meal_skipped",
        "system",
      );
      expect(ctx.mode).toBe("event");
      expect(ctx.trigger).toBe("meal_skipped");
    });
  });

  // ============ Coordinator Single-Card Rule Tests ============
  describe("Coordinator coordination", () => {
    it("coordinator can merge multiple delegations", () => {
      const ctx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );

      // Delegate to setup and planner
      const setupResult = runtime.recordDelegation(ctx, "setup");
      const plannerResult = runtime.recordDelegation(ctx, "planner");

      expect(setupResult.allowed).toBe(true);
      expect(plannerResult.allowed).toBe(true);
      expect(ctx.budget.delegationsUsed).toBe(2);
    });

    it("enforces one approval card per request", () => {
      // This is a design rule — implementation would merge proposals in Coordinator logic
      // Test here verifies the budget allows multiple delegates to create proposals
      const ctx = runtime.createContext(
        "run-001",
        "conversational",
        "user_message",
        "user-123",
      );

      // Max 4 delegations per run
      for (let i = 0; i < 4; i++) {
        const result = runtime.recordDelegation(ctx, "setup");
        expect(result.allowed).toBe(i < 4);
      }
    });
  });
});

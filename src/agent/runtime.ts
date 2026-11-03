/**
 * WP-4.1: Multi-agent runtime
 *
 * Core orchestration layer for the household agent team.
 * Agents register tools, call them deterministically, track budgets and state.
 *
 * Architecture:
 * - LLMClient: provider-agnostic interface (OpenRouter adapter for M4)
 * - Roster: JSON file defining all agents, their tools, roles, budgets
 * - Tool registration: agents declare which M1–M3 tools they can access
 * - Delegate: pattern for parent → child agent calls (coordinator → specialists)
 * - State: per-run execution tracking, parent/child relationships, budget accounting
 */

import type { LanguageModel } from 'ai';

/**
 * LLMClient: generic interface for LLM providers.
 * Implementations: OpenRouter (M4), others (M5+).
 */
export interface LLMClientOptions {
  provider: string; // 'openrouter', 'anthropic', 'openai', ...
  model: string; // model ID
  apiKey: string;
  baseURL?: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
}

export interface LLMRequest {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  temperature?: number;
  maxTokens?: number;
  tools?: Array<{
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }>;
  toolChoice?: 'auto' | 'required' | { type: 'tool'; name: string };
}

export interface LLMResponse {
  content: string;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens';
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMClient {
  complete(request: LLMRequest): Promise<LLMResponse>;
  streamComplete(request: LLMRequest): AsyncIterable<{ delta: string }>;
}

/**
 * OpenRouter implementation of LLMClient.
 */
export class OpenRouterClient implements LLMClient {
  private apiKey: string;
  private model: string;
  private baseURL: string = 'https://openrouter.ai/api/v1';

  constructor(options: LLMClientOptions) {
    if (options.provider !== 'openrouter') {
      throw new Error(`OpenRouterClient expects provider='openrouter', got '${options.provider}'`);
    }
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://onetable.app',
        'X-Title': 'OneTable',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 1024,
        tools: request.tools,
        tool_choice: request.toolChoice ?? 'auto',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenRouter error: ${response.status} ${error}`);
    }

    const data = (await response.json()) as any;
    const choice = data.choices[0];

    return {
      content: choice.message.content || '',
      stopReason: choice.finish_reason === 'tool_calls' ? 'tool_use' : 'end_turn',
      toolCalls: choice.message.tool_calls?.map((call: any) => ({
        id: call.id,
        name: call.function.name,
        arguments: JSON.parse(call.function.arguments),
      })),
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
      },
    };
  }

  async *streamComplete(request: LLMRequest): AsyncIterable<{ delta: string }> {
    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://onetable.app',
        'X-Title': 'OneTable',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 1024,
        stream: true,
        tools: request.tools,
        tool_choice: request.toolChoice ?? 'auto',
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter stream error: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const json = JSON.parse(data);
            const delta = json.choices[0]?.delta?.content;
            if (delta) {
              yield { delta };
            }
          } catch {
            // Ignore parse errors in streaming
          }
        }
      }
    }
  }
}

/**
 * Tool permission level.
 * X = execute (write to DB, call external service)
 * R = read (query DB, no side effects)
 * A = approve (used by approval inbox; requires user confirmation before execution)
 * P = (X level + policy check for sensitive ops)
 */
export type PermissionLevel = 'R' | 'A' | 'P' | 'X';

/**
 * Tool definition as registered by an agent.
 */
export interface ToolDefinition {
  name: string;
  description: string;
  permissionLevel: PermissionLevel;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>, context: AgentExecutionContext) => Promise<unknown>;
}

/**
 * Agent definition from roster.
 */
export interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  tools: string[]; // list of tool names this agent can call
  systemPrompt: string;
  memorySize?: number;
  budgetTokensPerRun?: number;
  budgetTokensPerWeek?: number;
}

/**
 * Execution state for a single agent run.
 */
export interface AgentExecutionContext {
  runId: string;
  agentId: string;
  householdId: string;
  userId: string;
  parentRunId?: string; // for delegated runs (coordinator → planner)
  startTime: Date;
  budget: {
    tokensUsed: number;
    tokensAllocated: number;
    approvalActionsCreated: number;
  };
  memory: Record<string, unknown>; // agent's working memory for this run
  logger: {
    log(level: string, msg: string, data?: Record<string, unknown>): void;
  };
}

/**
 * Roster loader: read agents and tools from JSON + validate permissions.
 */
export interface Roster {
  agents: Record<string, AgentDefinition>;
  tools: Record<string, ToolDefinition>;
}

export async function loadRoster(filePath: string): Promise<Roster> {
  // TODO: read JSON, validate agent tool references, return Roster
  throw new Error('loadRoster not yet implemented');
}

/**
 * Agent runner: initialize, set system prompt, call LLM, handle tool calls.
 */
export class AgentRunner {
  private client: LLMClient;
  private roster: Roster;

  constructor(client: LLMClient, roster: Roster) {
    this.client = client;
    this.roster = roster;
  }

  async run(agentId: string, userMessage: string, context: AgentExecutionContext): Promise<string> {
    const agent = this.roster.agents[agentId];
    if (!agent) {
      throw new Error(`Agent ${agentId} not found in roster`);
    }

    context.logger.log('info', `Agent ${agent.name} starting`, { agentId, userMessage });

    // TODO: implement agentic loop (call LLM → handle tool calls → loop until end_turn)
    throw new Error('AgentRunner.run not yet implemented');
  }
}

export type { AgentDefinition, ToolDefinition, Roster, LLMClient, OpenRouterClient, LLMClientOptions, LLMRequest, LLMResponse };

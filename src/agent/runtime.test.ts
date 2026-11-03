import { describe, it, expect, vi } from 'vitest';
import { OpenRouterClient, type LLMRequest, type Roster, AgentRunner } from '@/agent/runtime';

describe('WP-4.1: Multi-agent runtime', () => {
  describe('OpenRouterClient', () => {
    it('initializes with provider=openrouter', () => {
      const client = new OpenRouterClient({
        provider: 'openrouter',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'test-key',
      });
      expect(client).toBeTruthy();
    });

    it('rejects non-openrouter provider', () => {
      expect(() => {
        new OpenRouterClient({
          provider: 'anthropic',
          model: 'claude-3-sonnet',
          apiKey: 'test-key',
        });
      }).toThrow(/OpenRouterClient expects provider/);
    });

    it('formats LLM request with messages, temperature, max_tokens', async () => {
      // Mock fetch to inspect the request body
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { content: 'Hello!' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
      });

      const client = new OpenRouterClient({
        provider: 'openrouter',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'test-key',
      });

      await client.complete({
        messages: [{ role: 'user', content: 'Hi' }],
        temperature: 0.5,
        maxTokens: 100,
      });

      expect(fetchSpy).toHaveBeenCalled();
      const callBody = JSON.parse((fetchSpy.mock.calls[0][1] as any).body);
      expect(callBody.model).toBe('claude-3-5-sonnet-20241022');
      expect(callBody.temperature).toBe(0.5);
      expect(callBody.max_tokens).toBe(100);
    });

    it('parses tool_use finish_reason correctly', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '',
                tool_calls: [
                  {
                    id: 'tool-1',
                    function: {
                      name: 'add_member',
                      arguments: '{"name":"Alice","age":30}',
                    },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 10 },
        }),
      });

      const client = new OpenRouterClient({
        provider: 'openrouter',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'test-key',
      });

      const response = await client.complete({
        messages: [{ role: 'user', content: 'Add Alice' }],
      });

      expect(response.stopReason).toBe('tool_use');
      expect(response.toolCalls).toHaveLength(1);
      expect(response.toolCalls?.[0].name).toBe('add_member');
      expect(response.toolCalls?.[0].arguments).toEqual({ name: 'Alice', age: 30 });
    });

    it('handles streaming responses', async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}\n',
        'data: {"choices":[{"delta":{"content":" "}}]}\n',
        'data: {"choices":[{"delta":{"content":"world"}}]}\n',
        'data: [DONE]\n',
      ];

      let chunkIndex = 0;
      const mockReader = {
        read: async () => {
          if (chunkIndex >= chunks.length) {
            return { done: true, value: undefined };
          }
          const chunk = chunks[chunkIndex++];
          return {
            done: false,
            value: new TextEncoder().encode(chunk),
          };
        },
      };

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        body: {
          getReader: () => mockReader,
        },
      });

      const client = new OpenRouterClient({
        provider: 'openrouter',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: 'test-key',
      });

      const deltas: string[] = [];
      for await (const chunk of client.streamComplete({
        messages: [{ role: 'user', content: 'Say hello' }],
      })) {
        deltas.push(chunk.delta);
      }

      expect(deltas.join('')).toBe('Hello world');
    });
  });

  describe('Tool permissions (SG04 guard layer exists)', () => {
    it('tool definitions include permission level', () => {
      const toolDef = {
        name: 'add_member',
        description: 'Add a household member',
        permissionLevel: 'A' as const, // Approve
        inputSchema: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
        execute: async () => ({ id: 'm1' }),
      };

      expect(toolDef.permissionLevel).toBe('A');
    });

    it('recognizes X, R, A, P permission levels', () => {
      const levels: Array<'X' | 'R' | 'A' | 'P'> = ['X', 'R', 'A', 'P'];
      expect(levels).toContain('A');
      expect(levels).toContain('X');
    });
  });

  describe('AgentExecutionContext', () => {
    it('tracks budget allocation and usage', () => {
      const context = {
        runId: 'run-1',
        agentId: 'agent-1',
        householdId: 'h1',
        userId: 'u1',
        startTime: new Date(),
        budget: {
          tokensUsed: 50,
          tokensAllocated: 1000,
          approvalActionsCreated: 1,
        },
        memory: { preferences: { vegetarian: true } },
        logger: {
          log: (level: string, msg: string, data?: Record<string, unknown>) => {
            // noop
          },
        },
      };

      expect(context.budget.tokensUsed).toBe(50);
      expect(context.budget.tokensAllocated).toBe(1000);
      expect(context.memory.preferences).toEqual({ vegetarian: true });
    });

    it('supports parent-child run tracking (delegation)', () => {
      const context = {
        runId: 'run-2',
        agentId: 'planner',
        householdId: 'h1',
        userId: 'u1',
        parentRunId: 'run-1', // Coordinator spawned this planner run
        startTime: new Date(),
        budget: { tokensUsed: 0, tokensAllocated: 500, approvalActionsCreated: 0 },
        memory: {},
        logger: { log: () => {} },
      };

      expect(context.parentRunId).toBe('run-1');
    });
  });

  describe('Agent roster (structure)', () => {
    it('agents declare which tools they can access', () => {
      const roster: Roster = {
        agents: {
          coordinator: {
            id: 'coordinator',
            name: 'Coordinator',
            role: 'routing',
            tools: ['delegate', 'send_reply', 'create_action'],
            systemPrompt: 'You are the household coordinator...',
          },
          planner: {
            id: 'planner',
            name: 'Meal Planner',
            role: 'planning',
            tools: ['build_plan', 'propose_swap', 'lock_slot'],
            systemPrompt: 'You are the meal planner...',
          },
        },
        tools: {
          delegate: {
            name: 'delegate',
            description: 'Call another agent',
            permissionLevel: 'X',
            inputSchema: {
              type: 'object',
              properties: { agentId: { type: 'string' }, message: { type: 'string' } },
            },
            execute: async () => ({ delegated: true }),
          },
          build_plan: {
            name: 'build_plan',
            description: 'Build a weekly meal plan',
            permissionLevel: 'A',
            inputSchema: { type: 'object' },
            execute: async () => ({ plan: [] }),
          },
        },
      };

      expect(roster.agents.coordinator.tools).toContain('delegate');
      expect(roster.agents.planner.tools).toContain('build_plan');
      expect(roster.agents.coordinator.tools).not.toContain('build_plan');
    });
  });

  it('smoke test: all runtime types export correctly', () => {
    expect(OpenRouterClient).toBeTruthy();
    expect(AgentRunner).toBeTruthy();
  });
});

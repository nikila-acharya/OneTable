/**
 * WP-4.1 runtime: AgentExecutionContext, LLMClient, and agent request routing.
 * Provides execution context for agents (memory, state, permissions).
 */

export interface AgentExecutionContext {
  readonly requestId: string;
  readonly requestType: "onboarding" | "planning" | "review";
  readonly memberId: string | null;
  readonly householdId: string;
  memory: Record<string, unknown>;
  readonly permissions: {
    readonly execute: boolean; // X: execution permission
    readonly read: boolean; // R: read-only on member data
    readonly approvalGated: boolean; // A: approval-gated actions
  };
}

export interface LLMResponse {
  readonly prompt: string;
  readonly response: string;
  readonly model: string;
  readonly tokensUsed: number;
}

export class LLMClient {
  constructor(readonly apiKey: string = "mock") {}

  async generatePrompt(context: string, constraints?: string[]): Promise<LLMResponse> {
    // In production, this calls OpenRouter or other LLM provider
    // For testing, returns mock response
    const prompt = this.buildPrompt(context, constraints);
    return {
      prompt,
      response: "Mock LLM response",
      model: "mock",
      tokensUsed: 0,
    };
  }

  private buildPrompt(context: string, constraints?: string[]): string {
    let prompt = context;
    if (constraints && constraints.length > 0) {
      prompt += "\n\nConstraints:\n" + constraints.join("\n");
    }
    return prompt;
  }

  async askQuestion(question: string, context?: Record<string, unknown>): Promise<string> {
    const contextStr = context ? JSON.stringify(context) : "";
    const response = await this.generatePrompt(question, contextStr ? [contextStr] : undefined);
    return response.response;
  }
}

export function createAgentContext(
  householdId: string,
  requestType: "onboarding" | "planning" | "review",
  memberId: string | null = null,
): AgentExecutionContext {
  return {
    requestId: `req-${Date.now()}`,
    requestType,
    memberId,
    householdId,
    memory: {},
    permissions: {
      execute: false,
      read: true,
      approvalGated: true,
    },
  };
}

/**
 * WP-4.3: Coordinator Agent (AG01)
 *
 * Central orchestrator for meal-planning requests:
 * - Routes user input through Guardian (SG01–SG04 checks)
 * - Delegates to downstream agents: Setup, MealPlanner, Scout, Reviewer
 * - Streams responses to user (via streaming LLM calls)
 * - Merges agent outputs into coherent plans
 * - Manages approval inbox for A-level actions
 *
 * Coordinator has:
 * - R (read-only) access to planner outputs, recipe data, member preferences
 * - A (approve) access to user confirmations, plan locks, recipe approvals
 * - NO X (execute) or P (policy) access — Guardian owns safety veto
 */

import type { AgentExecutionContext, LLMClient } from './runtime';
import type { Guardian, GuardianDecision } from './guards/guardian';

/**
 * Routing decision: which agent(s) should handle this request?
 */
export interface RoutingDecision {
  route: 'setup' | 'meal_planner' | 'scout' | 'reviewer' | 'multi';
  requestType: 'onboarding' | 'plan' | 'recipe' | 'preference' | 'followup';
  downstreamAgents: string[];
  requiresApproval: boolean;
  escalationReason?: string;
}

/**
 * Agent card: output from one agent, ready for merging.
 */
export interface AgentCard {
  agentId: string;
  agentRole: 'setup' | 'meal_planner' | 'scout' | 'reviewer';
  timestamp: Date;
  content: string;
  structured?: {
    planId?: string;
    recipes?: Array<{ id: string; name: string; approved?: boolean }>;
    preferences?: Record<string, unknown>;
    message?: string;
  };
  needsApproval: boolean;
}

/**
 * Merged response: Coordinator's final output to user.
 */
export interface CoordinatorResponse {
  id: string;
  timestamp: Date;
  cards: AgentCard[];
  mergedText: string;
  streamable: true;
  requiresUserConfirm: boolean;
  approvalHoldingIds: string[];
}

/**
 * Coordinator agent: orchestrator.
 */
export class Coordinator {
  private agentId = 'coordinator';
  private pendingApprovals: Map<string, AgentCard> = new Map();

  /**
   * Parse user input and decide routing.
   */
  async parseAndRoute(userMessage: string, context: AgentExecutionContext): Promise<RoutingDecision> {
    const lowerMsg = userMessage.toLowerCase();

    // Intent detection (priority-ordered for M4)
    
    // Highest: explicit meal planning
    if (
      lowerMsg.includes('plan') &&
      (lowerMsg.includes('meal') || lowerMsg.includes('week') || lowerMsg.includes('dinner') || lowerMsg.includes('lunch'))
    ) {
      return {
        route: 'meal_planner',
        requestType: 'plan',
        downstreamAgents: ['meal_planner', 'scout'],
        requiresApproval: true,
      };
    }

    // Recipes
    if (lowerMsg.includes('recipe') || lowerMsg.includes('cook')) {
      return {
        route: 'scout',
        requestType: 'recipe',
        downstreamAgents: ['scout'],
        requiresApproval: true,
      };
    }

    // Setup (allergies, conditions, diet, preferences)
    if (
      lowerMsg.includes('allerg') ||
      lowerMsg.includes('condition') ||
      lowerMsg.includes('diet') ||
      lowerMsg.includes('prefer') ||
      lowerMsg.includes("can't") ||
      lowerMsg.includes('avoid') ||
      lowerMsg.includes('restrict')
    ) {
      return {
        route: 'setup',
        requestType: 'onboarding',
        downstreamAgents: ['setup'],
        requiresApproval: true,
        escalationReason: 'Member profile update: verify allergies and constraints',
      };
    }

    // Followup / questions
    if (lowerMsg.includes('how') || lowerMsg.includes('why') || lowerMsg.includes('what')) {
      return {
        route: 'reviewer',
        requestType: 'followup',
        downstreamAgents: ['reviewer'],
        requiresApproval: false,
      };
    }

    // Default: multi-agent exploration
    return {
      route: 'multi',
      requestType: 'followup',
      downstreamAgents: ['meal_planner', 'scout'],
      requiresApproval: true,
    };
  }

  /**
   * Stream response via LLM to user while Coordinator orchestrates.
   */
  async streamResponse(
    userMessage: string,
    context: AgentExecutionContext,
    llmClient: LLMClient,
    guardian: Guardian
  ): Promise<CoordinatorResponse> {
    // Step 1: Check input safety
    const inputDecision = await guardian.checkInput(userMessage, context);
    if (inputDecision.finalDecision === 'escalate') {
      return {
        id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date(),
        cards: [],
        mergedText: guardian.getSG04SupportiveReply(),
        streamable: true,
        requiresUserConfirm: false,
        approvalHoldingIds: [],
      };
    }

    // Step 2: Route to downstream agents
    const routing = await this.parseAndRoute(userMessage, context);

    context.logger.log('info', 'Coordinator routing', {
      route: routing.route,
      agents: routing.downstreamAgents,
      requiresApproval: routing.requiresApproval,
    });

    // Step 3: Collect agent outputs (simulated for M4)
    const cards: AgentCard[] = [];

    for (const agent of routing.downstreamAgents) {
      // In M5+, call actual agent runners
      // For M4, simulate via LLM
      const agentPrompt = `You are the ${agent} agent in a meal-planning household system.
User request: "${userMessage}"

Respond as the ${agent} agent would, in 1-2 sentences. Be supportive and ask clarifying questions if needed.`;

      // Placeholder: would call llmClient.chat() here with streaming
      // For now, just create a mock card
      cards.push({
        agentId: agent,
        agentRole: agent as any,
        timestamp: new Date(),
        content: `[${agent} response to: ${userMessage.slice(0, 30)}...]`,
        needsApproval: routing.requiresApproval,
      });
    }

    // Step 4: Check outputs through Guardian
    let allApproved = true;
    const approvalHolds: string[] = [];

    for (const card of cards) {
      const outputDecision = await guardian.checkOutput(
        {
          type: 'message',
          content: card.content,
          metadata: card.structured,
        },
        context
      );

      if (outputDecision.finalDecision !== 'approved') {
        allApproved = false;
        if (card.needsApproval) {
          approvalHolds.push(card.agentId);
          this.pendingApprovals.set(card.agentId, card);

          context.logger.log('warn', 'Agent card held in approval inbox', {
            agentId: card.agentId,
            reason: outputDecision.escalationReason,
          });
        }
      }
    }

    // Step 5: Merge cards into response
    const mergedText = this.mergeCards(cards, routing);

    return {
      id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      cards,
      mergedText,
      streamable: true,
      requiresUserConfirm: !allApproved || routing.requiresApproval,
      approvalHoldingIds: approvalHolds,
    };
  }

  /**
   * Merge agent cards into one coherent response text.
   */
  private mergeCards(cards: AgentCard[], routing: RoutingDecision): string {
    if (cards.length === 0) return 'No response available.';

    if (cards.length === 1) {
      return cards[0].content;
    }

    // Multi-card merge
    const sections = cards
      .map((card) => {
        const agentName = card.agentRole.charAt(0).toUpperCase() + card.agentRole.slice(1);
        return `**${agentName}:**\n${card.content}`;
      })
      .join('\n\n');

    return sections;
  }

  /**
   * User confirms an approval hold — release it to execution.
   */
  async confirmApproval(
    agentId: string,
    context: AgentExecutionContext,
    guardian: Guardian
  ): Promise<{ approved: boolean; reason?: string }> {
    const card = this.pendingApprovals.get(agentId);
    if (!card) {
      return {
        approved: false,
        reason: `No pending approval for agent ${agentId}`,
      };
    }

    // Final Guardian check before execution
    const decision = await guardian.checkOutput(
      {
        type: 'message',
        content: card.content,
      },
      context
    );

    if (decision.finalDecision !== 'approved') {
      context.logger.log('warn', 'User-confirmed card still rejected by Guardian', {
        agentId,
        reason: decision.escalationReason,
      });

      return {
        approved: false,
        reason: decision.escalationReason,
      };
    }

    this.pendingApprovals.delete(agentId);
    context.logger.log('info', 'User-confirmed card approved and released to execution', {
      agentId,
    });

    return { approved: true };
  }

  /**
   * Get pending approvals (for UI inbox display).
   */
  getPendingApprovals(): AgentCard[] {
    return Array.from(this.pendingApprovals.values());
  }

  /**
   * Clear approvals (per-conversation reset).
   */
  clearPendingApprovals(): void {
    this.pendingApprovals.clear();
  }
}

export type { RoutingDecision, AgentCard, CoordinatorResponse };

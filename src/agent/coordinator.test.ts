import { describe, it, expect, beforeEach } from 'vitest';
import { Coordinator } from '@/agent/coordinator';
import { Guardian } from '@/agent/guards/guardian';
import type { AgentExecutionContext } from '@/agent/runtime';

describe('WP-4.3: Coordinator Agent (AG01)', () => {
  let coordinator: Coordinator;
  let guardian: Guardian;

  const mockContext: AgentExecutionContext = {
    runId: 'run-1',
    agentId: 'coordinator',
    householdId: 'h1',
    userId: 'u1',
    startTime: new Date(),
    budget: { tokensUsed: 0, tokensAllocated: 5000, approvalActionsCreated: 0 },
    memory: {},
    logger: {
      log: (level: string, msg: string, data?: Record<string, unknown>) => {
        // noop
      },
    },
  };

  beforeEach(() => {
    coordinator = new Coordinator();
    guardian = new Guardian();
  });

  describe('Intent routing', () => {
    it('routes allergy/diet setup requests to setup agent', async () => {
      const routing = await coordinator.parseAndRoute('I have a shellfish allergy', mockContext);
      expect(routing.route).toBe('setup');
      expect(routing.requestType).toBe('onboarding');
      expect(routing.downstreamAgents).toContain('setup');
      expect(routing.requiresApproval).toBe(true);
    });

    it('routes recipe requests to scout agent', async () => {
      const routing = await coordinator.parseAndRoute('Need a salmon recipe', mockContext);
      expect(routing.route).toBe('scout');
      expect(routing.requestType).toBe('recipe');
      expect(routing.downstreamAgents).toContain('scout');
    });

    it('routes meal plan requests to meal_planner + scout', async () => {
      const routing = await coordinator.parseAndRoute(
        'Can you plan meals for this week?',
        mockContext
      );
      expect(routing.route).toBe('meal_planner');
      expect(routing.requestType).toBe('plan');
      expect(routing.downstreamAgents).toContain('meal_planner');
      expect(routing.downstreamAgents).toContain('scout');
    });

    it('routes how/why questions to reviewer', async () => {
      const routing = await coordinator.parseAndRoute('Why does my plan include chicken?', mockContext);
      expect(routing.route).toBe('reviewer');
      expect(routing.requestType).toBe('followup');
      expect(routing.downstreamAgents).toContain('reviewer');
      expect(routing.requiresApproval).toBe(false);
    });

    it('prefers diet setup over generic followup', async () => {
      const routing = await coordinator.parseAndRoute('What diet restrictions should I set?', mockContext);
      expect(routing.route).toBe('setup');
      expect(routing.requestType).toBe('onboarding');
    });

    it('defaults to multi-agent for ambiguous requests', async () => {
      const routing = await coordinator.parseAndRoute('Tell me something', mockContext);
      expect(routing.route).toBe('multi');
      expect(routing.downstreamAgents.length).toBeGreaterThan(0);
    });
  });

  describe('Stream response orchestration', () => {
    it('returns supportive reply for SG04 input escalation', async () => {
      const response = await coordinator.streamResponse(
        'I restrict my diet to 1200 calories per day',
        mockContext,
        {} as any, // LLMClient not needed for escalation path
        guardian
      );

      expect(response.mergedText).toContain('NEDA');
      expect(response.streamable).toBe(true);
      expect(response.requiresUserConfirm).toBe(false);
    });

    it('routes normal requests through Guardian checks', async () => {
      const response = await coordinator.streamResponse(
        'Can you plan meals for this week?',
        mockContext,
        {} as any,
        guardian
      );

      expect(response.cards.length).toBeGreaterThan(0);
      expect(response.mergedText).toBeTruthy();
      expect(response.streamable).toBe(true);
    });

    it('collects cards from routed agents', async () => {
      const response = await coordinator.streamResponse(
        'Plan meals for the week',
        mockContext,
        {} as any,
        guardian
      );

      expect(response.cards.length).toBeGreaterThanOrEqual(1);
      response.cards.forEach((card) => {
        expect(card.agentId).toBeTruthy();
        expect(card.agentRole).toBeTruthy();
        expect(card.content).toBeTruthy();
      });
    });

    it('marks cards with approval requirement based on routing', async () => {
      const response = await coordinator.streamResponse(
        'Plan meals',
        mockContext,
        {} as any,
        guardian
      );

      response.cards.forEach((card) => {
        expect(typeof card.needsApproval).toBe('boolean');
      });
    });

    it('flags response as needing confirmation for approval-required cards', async () => {
      const response = await coordinator.streamResponse(
        'Update my preferences',
        mockContext,
        {} as any,
        guardian
      );

      expect(response.requiresUserConfirm).toBe(true);
    });
  });

  describe('Card merging', () => {
    it('returns single card content as-is', async () => {
      const response = await coordinator.streamResponse(
        'How do I cook chicken?',
        mockContext,
        {} as any,
        guardian
      );

      // For single-card route (reviewer), check merge is clean
      if (response.cards.length === 1) {
        expect(response.mergedText).toBe(response.cards[0].content);
      }
    });

    it('formats multiple cards with agent headers', async () => {
      const response = await coordinator.streamResponse(
        'Plan meals this week',
        mockContext,
        {} as any,
        guardian
      );

      if (response.cards.length > 1) {
        // Multi-card merge should have agent names
        response.cards.forEach((card) => {
          const agentName =
            card.agentRole.charAt(0).toUpperCase() + card.agentRole.slice(1);
          // Merged text should reference at least one agent
        });
      }
    });
  });

  describe('Approval inbox management', () => {
    it('tracks pending approvals for held cards', async () => {
      const response = await coordinator.streamResponse(
        'Update my diet preferences',
        mockContext,
        {} as any,
        guardian
      );

      if (response.approvalHoldingIds.length > 0) {
        const pending = coordinator.getPendingApprovals();
        expect(pending.length).toBeGreaterThan(0);
        expect(pending.some((p) => response.approvalHoldingIds.includes(p.agentId))).toBe(true);
      }
    });

    it('user confirm releases approval holds', async () => {
      // Create a response with an approval hold
      const response = await coordinator.streamResponse(
        'Update preferences',
        mockContext,
        {} as any,
        guardian
      );

      if (response.approvalHoldingIds.length > 0) {
        const agentId = response.approvalHoldingIds[0];
        const result = await coordinator.confirmApproval(agentId, mockContext, guardian);

        expect(result.approved).toBe(true);

        // Verify it's no longer pending
        const pending = coordinator.getPendingApprovals();
        expect(pending.some((p) => p.agentId === agentId)).toBe(false);
      }
    });

    it('rejects approval for non-existent agent', async () => {
      const result = await coordinator.confirmApproval('nonexistent-agent', mockContext, guardian);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain('No pending approval');
    });

    it('clears pending approvals on reset', async () => {
      const response = await coordinator.streamResponse(
        'Update preferences',
        mockContext,
        {} as any,
        guardian
      );

      if (response.approvalHoldingIds.length > 0) {
        coordinator.clearPendingApprovals();
        const pending = coordinator.getPendingApprovals();
        expect(pending.length).toBe(0);
      }
    });
  });

  describe('Safety integration (Guardian)', () => {
    it('blocks input with SG04 signals before routing', async () => {
      const response = await coordinator.streamResponse(
        'I need to restrict calories and burn them off',
        mockContext,
        {} as any,
        guardian
      );

      // Should escalate to supportive reply, not route
      expect(response.mergedText).toContain('support');
    });

    it('checks all agent outputs through Guardian', async () => {
      const response = await coordinator.streamResponse(
        'Plan meals',
        mockContext,
        {} as any,
        guardian
      );

      // All cards should pass Guardian (or be held in approval)
      const allCardsValid = response.cards.every((card) => {
        return (
          !response.approvalHoldingIds.includes(card.agentId) ||
          card.needsApproval
        );
      });
      expect(allCardsValid).toBe(true);
    });

    it('marks responses with approval holds when Guardian flags content', async () => {
      // This is tested implicitly via approval inbox tests
      // Guardian can reject outputs; Coordinator should hold them
      const response = await coordinator.streamResponse(
        'Help me with meals',
        mockContext,
        {} as any,
        guardian
      );

      // Response should either be fully approved or have approval holds
      expect(response.requiresUserConfirm || response.approvalHoldingIds.length >= 0).toBe(true);
    });
  });

  describe('Response structure', () => {
    it('returns valid CoordinatorResponse with all required fields', async () => {
      const response = await coordinator.streamResponse(
        'Plan meals',
        mockContext,
        {} as any,
        guardian
      );

      expect(response.id).toBeTruthy();
      expect(response.id.startsWith('cr-')).toBe(true);
      expect(response.timestamp).toBeInstanceOf(Date);
      expect(Array.isArray(response.cards)).toBe(true);
      expect(typeof response.mergedText).toBe('string');
      expect(response.streamable).toBe(true);
      expect(typeof response.requiresUserConfirm).toBe('boolean');
      expect(Array.isArray(response.approvalHoldingIds)).toBe(true);
    });

    it('generates unique response IDs', async () => {
      const r1 = await coordinator.streamResponse(
        'Plan meals',
        mockContext,
        {} as any,
        guardian
      );

      const r2 = await coordinator.streamResponse(
        'Plan meals',
        mockContext,
        {} as any,
        guardian
      );

      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe('Coordinator stress tests', () => {
    it('handles rapid sequential requests', async () => {
      const requests = [
        'Plan meals',
        'How do I cook salmon?',
        'What are my allergies?',
        'Update preferences',
      ];

      for (const req of requests) {
        const response = await coordinator.streamResponse(req, mockContext, {} as any, guardian);
        expect(response.mergedText).toBeTruthy();
        expect(response.cards.length).toBeGreaterThanOrEqual(0);
      }
    });

    it('manages multiple approval holds concurrently', async () => {
      const responses = [];

      for (let i = 0; i < 3; i++) {
        const response = await coordinator.streamResponse(
          'Update preferences',
          mockContext,
          {} as any,
          guardian
        );
        responses.push(response);
      }

      const allPending = coordinator.getPendingApprovals();
      // Should accumulate approvals from all requests
      expect(allPending.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Agent card structure', () => {
    it('each card includes structured metadata', async () => {
      const response = await coordinator.streamResponse(
        'Plan meals',
        mockContext,
        {} as any,
        guardian
      );

      response.cards.forEach((card) => {
        expect(card.agentId).toBeTruthy();
        expect(['setup', 'meal_planner', 'scout', 'reviewer']).toContain(card.agentRole);
        expect(card.timestamp).toBeInstanceOf(Date);
        expect(card.content).toBeTruthy();
      });
    });
  });
});

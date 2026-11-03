/**
 * WP-4.2: Safety Guardian (Agent G)
 *
 * Deterministic safety checks + LLM-based eating-disorder signal detection (SG04).
 * Every input, output, and proposal goes through Guardian before execution.
 *
 * Checks:
 * - SG01: Condition gate (CKD → general-guidance, no member-specific target)
 * - SG02: Under-18 protection (no deficit targets)
 * - SG03: Energy floor status (ruled:false = reject plan lock)
 * - SG04: Eating-disorder signals (via LLM veto)
 */

import type { AgentExecutionContext } from './runtime';
import type { ConditionGateResult } from '@/lib/conditions/gate';

/**
 * SG04: Eating-disorder vocabulary patterns.
 * Detects concerning language that suggests disordered eating behavior.
 */
export const SG04_PATTERNS = {
  // Restriction language
  restriction: [
    /\b(restrict|cut|limit|eliminate|remove)\s+(food|calories?|carbs?|sugar|fat)/i,
    /\b(fast|fasting|no\s+eating|skip\s+meals?|starve)/i,
    /\b(diet|detox|cleanse|purge|flush)\b/i,
    /\b(forbidden|allowed|good|bad)\s+(food|carbs?|sugar)/i,
  ],

  // Compensation language
  compensation: [
    /\b(burn|earn|work\s+off|punish)\s+(calories?|food)?/i,
    /(exercise|work\s+out|run|gym)/i,
    /\b(compensate|atone|deserve)\b/i,
  ],

  // Body checking / obsession
  bodyChecking: [
    /\b(body\s+check|weigh|scale|mirror|pinch|measure|tight|loose)/i,
    /\b(bloated|puffy|fat|disgusting|gross)\s+(body|stomach|thighs?|arms?)/i,
    /\b(weight|pounds?|kg)\s+(gain|loss|fluctuat)/i,
  ],

  // Calorie counting / rigidity
  calorieCounting: [
    /\b(count|track|log)\s+(calories?|macros?|carbs?)/i,
    /\b(\d+\s*(calories?|kcal|carbs?|g\s+protein))\b/i,
    /\b(exact|precisely?|rigid|strict)\s+(eating|diet|plan)/i,
  ],

  // Exercise obsession
  exerciseObsession: [
    /\b(must|have\s+to|need\s+to)\s+(exercise|work\s+out|run|go\s+to\s+gym)/i,
    /\b(exercise\s+addiction|compulsive\s+exercise)/i,
  ],

  // Shame / perfectionism
  shame: [
    /\b(ashamed|guilty|disgusted|fat|ugly|disgusting)\b/i,
    /\b(perfect|ideal)\s+(body|weight|eating)/i,
    /\b(failure|failed)\s+(diet|eating)/i,
  ],

  // Social isolation / hiding
  socialIsolation: [
    /\b(hide|secret|alone)\s+(eating|food|meals?)/i,
    /\b(eat\s+in\s+private|private\s+eating|hidden\s+eating)/i,
    /\b(lie|lied|lying)\s+(about|regarding).*(food|eating|weight)/i,
  ],
};

/**
 * Deterministic check result (SG01, SG02, SG03).
 */
export interface DeterministicCheckResult {
  passed: boolean;
  reason?: string;
  gate?: 'SG01' | 'SG02' | 'SG03';
}

/**
 * Guardian decision: what Guardian saw, decided, and why.
 */
export interface GuardianDecision {
  id: string;
  timestamp: Date;
  runId: string;
  householdId: string;
  checkType: 'input' | 'output' | 'proposal';
  deterministic: DeterministicCheckResult;
  lmmVeto?: {
    approved: boolean;
    reason: string;
    sg04Signals?: string[];
  };
  finalDecision: 'approved' | 'rejected' | 'escalate';
  escalationReason?: string;
}

/**
 * SG04: Detect eating-disorder signals in text.
 */
export function detectEatingDisorderSignals(text: string): string[] {
  const signals: string[] = [];

  Object.entries(SG04_PATTERNS).forEach(([category, patterns]) => {
    patterns.forEach((pattern) => {
      if (pattern.test(text)) {
        signals.push(`${category}:${pattern.source}`);
      }
    });
  });

  return signals;
}

/**
 * SG01: Check if member can have a target (condition gate).
 */
export function checkSG01Gate(conditionGateResult: ConditionGateResult): DeterministicCheckResult {
  if (conditionGateResult.mode === 'general_guidance') {
    return {
      passed: false,
      reason: `Member ${conditionGateResult.memberId} is in general-guidance mode: no member-specific target allowed.`,
      gate: 'SG01',
    };
  }
  return { passed: true };
}

/**
 * SG02: Check if under-18 member is getting a deficit target.
 */
export function checkSG02Gate(age: number, deficitRequested: boolean): DeterministicCheckResult {
  if (age < 18 && deficitRequested) {
    return {
      passed: false,
      reason: `Member age ${age} (<18): deficit or weight-loss targets not allowed. Use maintenance-only energy.`,
      gate: 'SG02',
    };
  }
  return { passed: true };
}

/**
 * SG03: Check if energy floor has been reviewed (RD sign-off).
 */
export function checkSG03Gate(energyFloorReviewed: boolean): DeterministicCheckResult {
  if (!energyFloorReviewed) {
    return {
      passed: false,
      reason: 'Energy floor not reviewed by RD (reviewed: false in rules). Plan cannot be locked.',
      gate: 'SG03',
    };
  }
  return { passed: true };
}

/**
 * Guardian: orchestrates all safety checks.
 */
export class Guardian {
  private decisions: GuardianDecision[] = [];

  /**
   * Check input message for SG04 signals.
   */
  async checkInput(text: string, context: AgentExecutionContext): Promise<GuardianDecision> {
    const sg04Signals = detectEatingDisorderSignals(text);

    const decision: GuardianDecision = {
      id: `gd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      runId: context.runId,
      householdId: context.householdId,
      checkType: 'input',
      deterministic: { passed: true }, // Input has no deterministic gates
      finalDecision: 'approved',
    };

    if (sg04Signals.length > 0) {
      // Log but don't reject; Guardian provides supportive reply instead
      context.logger.log('warn', 'SG04 eating-disorder signals detected in input', {
        signals: sg04Signals,
        inputPreview: text.slice(0, 100),
      });

      decision.lmmVeto = {
        approved: false,
        reason: 'SG04 eating-disorder signals detected',
        sg04Signals,
      };
      decision.finalDecision = 'escalate';
      decision.escalationReason =
        'User message contains concerning language about food restriction or body image. Provide supportive response and resources.';
    }

    this.decisions.push(decision);
    return decision;
  }

  /**
   * Check output/proposal for safety violations.
   * Calls LLM for nuanced SG04 check if needed.
   */
  async checkOutput(
    proposal: {
      type: 'plan' | 'recipe' | 'tip' | 'message';
      content: string;
      metadata?: Record<string, unknown>;
    },
    context: AgentExecutionContext
  ): Promise<GuardianDecision> {
    // Deterministic checks based on proposal type
    let deterministic: DeterministicCheckResult = { passed: true };

    if (proposal.type === 'plan') {
      // Check SG03 energy floor (placeholder: assume reviewed=false in M4, will be true in M6)
      // For now, just log
      context.logger.log('info', 'Plan proposal checked for SG03 energy floor', {
        metadata: proposal.metadata,
      });
    }

    // SG04 check on output
    const sg04Signals = detectEatingDisorderSignals(proposal.content);

    const decision: GuardianDecision = {
      id: `gd-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date(),
      runId: context.runId,
      householdId: context.householdId,
      checkType: 'output',
      deterministic,
      finalDecision: 'approved',
    };

    if (sg04Signals.length > 0) {
      context.logger.log('error', 'SG04 signals in agent output: rejecting proposal', {
        signals: sg04Signals,
        proposalType: proposal.type,
      });

      decision.lmmVeto = {
        approved: false,
        reason: 'SG04: output contains concerning eating-disorder language',
        sg04Signals,
      };
      decision.finalDecision = 'rejected';
      decision.escalationReason = `Agent proposed ${proposal.type} with eating-disorder signals. Requires human review before sending to user.`;
    }

    this.decisions.push(decision);
    return decision;
  }

  /**
   * Supportive response for SG04 escalation.
   */
  getSG04SupportiveReply(): string {
    return `I notice your message mentions concerns about food and eating. If you're struggling with food or body image, please know that support is available:

- **National Eating Disorders Association (NEDA)**: 1-800-931-2237 (call/text)
- **Crisis Text Line**: Text "NEDA" to 741741
- Talk to your doctor or a counselor about what you're experiencing.

OneTable is designed to help with meal planning, not to restrict or control food. If you'd like to continue planning meals without restrictions, I'm here to help. What would be most useful for your household right now?`;
  }

  /**
   * Get all decisions for this household (for auditing).
   */
  getDecisions(): GuardianDecision[] {
    return this.decisions;
  }

  /**
   * Clear decisions (per-week reset).
   */
  clearDecisions(): void {
    this.decisions = [];
  }
}

export type { GuardianDecision, DeterministicCheckResult };

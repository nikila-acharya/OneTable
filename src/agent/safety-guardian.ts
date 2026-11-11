/**
 * WP-4.2 — Safety Guardian Agent: Independent checker with deterministic + LLM-based safety.
 * Runs on every user message (SG04), every outgoing message (7.3), and every proposal.
 * Returns: pass | block(reason) | replace_with(message_id)
 */

import type { AgentExecutionContext, LLMToolCall } from "./runtime";
import { LLMClient } from "./runtime";
import {
  DeterministicSafetyChecker,
  GuardianDecisionLog,
  GuardianDecisionRecord,
  ProposalChecker,
  SAFE_FALLBACK_MESSAGES,
  CLINICIAN_CONFIRM_MESSAGE,
} from "./safety-rules";
import { getAgentConfig } from "./roster";

export type GuardianCheckType = "input" | "output" | "proposal";
export type GuardianDecision = "pass" | "block" | "replace";

export interface GuardianCheckResult {
  decision: GuardianDecision;
  reason?: string; // Why blocked or replaced
  replacementMessageId?: string; // For replace decision
  failedChecks: string[]; // Which rules failed
  record: GuardianDecisionRecord; // Logged for eval suite
}

/**
 * Safety Guardian Agent.
 * Block-only: cannot approve or create anything, only pass/block/replace.
 */
export class SafetyGuardian {
  private llm: LLMClient;
  private decisionLog: GuardianDecisionLog;
  private config = getAgentConfig("guardian");

  constructor(private context: AgentExecutionContext) {
    this.llm = new LLMClient(this.config.model);
    this.decisionLog = new GuardianDecisionLog();
  }

  /**
   * Check a user message for SG04 (restriction/eating disorder signals).
   * Runs before any agent sees it.
   */
  async checkInputMessage(
    messageId: string,
    message: string,
    householdMembers: Array<{ memberId: string; name: string; birthYear: number }>,
  ): Promise<GuardianCheckResult> {
    const failedChecks: string[] = [];

    // 1. Deterministic check for restriction signals (SG04)
    const restrictionCheck = DeterministicSafetyChecker.checkRestrictionSignals(
      message,
      householdMembers,
    );
    if (restrictionCheck.found) {
      failedChecks.push(`SG04: Restriction signal detected: "${restrictionCheck.signal}"`);
      if (restrictionCheck.affectedMemberId) {
        failedChecks.push(`Affected member: ${restrictionCheck.affectedMemberId}`);
      }
    }

    // 2. If deterministic check blocked, return immediately
    if (failedChecks.length > 0) {
      const record = this.decisionLog.recordDecision({
        messageId,
        checkType: "input",
        decision: "block",
        reason: failedChecks[0],
        failedChecks,
      });

      return {
        decision: "block",
        reason: failedChecks[0],
        failedChecks,
        record,
      };
    }

    // 3. LLM check for nuanced restriction language
    const llmCheck = await this.runLLMInputCheck(message, householdMembers);
    if (llmCheck.decision === "block") {
      const record = this.decisionLog.recordDecision({
        messageId,
        checkType: "input",
        decision: "block",
        reason: llmCheck.reason,
        failedChecks: llmCheck.failedChecks,
      });

      return {
        decision: "block",
        reason: llmCheck.reason,
        failedChecks: llmCheck.failedChecks,
        record,
      };
    }

    // 4. Pass
    const record = this.decisionLog.recordDecision({
      messageId,
      checkType: "input",
      decision: "pass",
      failedChecks: [],
    });

    return { decision: "pass", failedChecks: [], record };
  }

  /**
   * Check an outgoing message against 7.3 message guard.
   * Deterministic checks first, then LLM refinement.
   */
  async checkOutputMessage(
    messageId: string,
    message: string,
    householdMembers: Array<{ memberId: string; name: string; birthYear: number }>,
  ): Promise<GuardianCheckResult> {
    const failedChecks: string[] = [];

    // 1. Banned copy check
    const bannedCopyCheck = DeterministicSafetyChecker.checkBannedCopy(message);
    if (bannedCopyCheck.found) {
      failedChecks.push(`Banned terms: ${bannedCopyCheck.terms?.join(", ")}`);
    }

    // 2. Under-18 weight language check
    const under18Check = DeterministicSafetyChecker.checkUnder18WeightLanguage(
      message,
      householdMembers,
    );
    if (under18Check.found) {
      failedChecks.push(
        `Weight/calorie language near under-18 member: ${under18Check.memberName}`,
      );
    }

    // 3. Health advice without source
    const healthAdviceCheck = DeterministicSafetyChecker.checkHealthAdviceWithoutSource(message);
    if (healthAdviceCheck.found) {
      failedChecks.push(`Health advice without source: "${healthAdviceCheck.adviceText}"`);
    }

    // If deterministic checks failed, try to replace
    if (failedChecks.length > 0) {
      // Map failed check to safe replacement
      const replacementId = this.getReplacementMessage(failedChecks);

      const record = this.decisionLog.recordDecision({
        messageId,
        checkType: "output",
        decision: "replace",
        reason: failedChecks[0],
        replacementMessageId: replacementId,
        failedChecks,
      });

      return {
        decision: "replace",
        reason: failedChecks[0],
        replacementMessageId: replacementId,
        failedChecks,
        record,
      };
    }

    // 4. LLM refinement check
    const llmCheck = await this.runLLMOutputCheck(message);
    if (llmCheck.decision === "replace") {
      const record = this.decisionLog.recordDecision({
        messageId,
        checkType: "output",
        decision: "replace",
        reason: llmCheck.reason,
        replacementMessageId: llmCheck.replacementMessageId,
        failedChecks: llmCheck.failedChecks,
      });

      return {
        decision: "replace",
        reason: llmCheck.reason,
        replacementMessageId: llmCheck.replacementMessageId,
        failedChecks: llmCheck.failedChecks,
        record,
      };
    }

    // 5. Pass
    const record = this.decisionLog.recordDecision({
      messageId,
      checkType: "output",
      decision: "pass",
      failedChecks: [],
    });

    return { decision: "pass", failedChecks: [], record };
  }

  /**
   * Check a proposal (plan diff, approval card) for health advice and missing sources.
   */
  async checkProposal(
    messageId: string,
    proposal: {
      title?: string;
      diff?: Record<string, unknown>;
      summary?: string;
      healthImpact?: boolean;
    },
  ): Promise<GuardianCheckResult> {
    const failedChecks: string[] = [];

    // 1. Deterministic proposal check
    const proposalCheck = ProposalChecker.checkProposal(proposal);
    if (!proposalCheck.safe) {
      failedChecks.push(...proposalCheck.issues);
    }

    if (failedChecks.length > 0) {
      const record = this.decisionLog.recordDecision({
        messageId,
        checkType: "proposal",
        decision: "block",
        reason: failedChecks[0],
        failedChecks,
      });

      return {
        decision: "block",
        reason: failedChecks[0],
        failedChecks,
        record,
      };
    }

    // 2. Pass
    const record = this.decisionLog.recordDecision({
      messageId,
      checkType: "proposal",
      decision: "pass",
      failedChecks: [],
    });

    return { decision: "pass", failedChecks: [], record };
  }

  /**
   * Run LLM-based input check for nuanced restriction language.
   */
  private async runLLMInputCheck(
    message: string,
    householdMembers: Array<{ memberId: string; name: string; birthYear: number }>,
  ): Promise<{ decision: GuardianDecision; reason?: string; failedChecks: string[] }> {
    const childrenNames = householdMembers
      .filter((m) => new Date().getFullYear() - m.birthYear < 18)
      .map((m) => m.name)
      .join(", ");

    const systemPrompt = `You are a safety checker. Analyze this message for eating-disorder signals or unhealthy restriction language.

Children in this household: ${childrenNames || "none"}

Block if the message:
- Suggests limiting a child's food intake
- Uses restriction language about eating or weight
- Could normalize unhealthy eating behaviors
- Asks the agent to enforce weight loss on anyone, especially children

Otherwise, pass.

Respond with ONLY:
pass
OR
block: [one-sentence reason]`;

    try {
      this.llm.resetHistory();
      const result = await this.llm.callWithTools(systemPrompt, `Check this message: "${message}"`, []);

      const text = result.text.toLowerCase();
      if (text.includes("block")) {
        const reason = text.split("block:")[1]?.trim() || "LLM-detected restriction signal";
        return {
          decision: "block",
          reason,
          failedChecks: ["LLM-detected SG04 signal"],
        };
      }

      return {
        decision: "pass",
        failedChecks: [],
      };
    } catch (error) {
      // On LLM error, allow the message (fail open)
      console.error("Guardian LLM check failed:", error);
      return { decision: "pass", failedChecks: [] };
    }
  }

  /**
   * Run LLM-based output check for nuanced safety issues.
   */
  private async runLLMOutputCheck(
    message: string,
  ): Promise<{
    decision: GuardianDecision;
    reason?: string;
    replacementMessageId?: string;
    failedChecks: string[];
  }> {
    const systemPrompt = `You are a safety checker for a family nutrition app. Analyze this outgoing message for health-advice language, diet-culture terms, or shame language.

The message should:
- Be supportive and judgment-free
- Not give medical advice
- Not shame families for food choices
- Not use diet-culture language (guilt-free, earn your meal, etc.)
- Include sources for any nutrition claims

Respond with ONLY:
pass
OR
needs_replacement: [one-sentence reason]`;

    try {
      this.llm.resetHistory();
      const result = await this.llm.callWithTools(systemPrompt, `Check this message: "${message}"`, []);

      const text = result.text.toLowerCase();
      if (text.includes("needs_replacement")) {
        const reason = text.split("needs_replacement:")[1]?.trim() || "Unsafe language detected";
        return {
          decision: "replace",
          reason,
          replacementMessageId: "fallback_safe_message",
          failedChecks: ["LLM-detected unsafe language"],
        };
      }

      return {
        decision: "pass",
        failedChecks: [],
      };
    } catch (error) {
      // On LLM error, allow the message (fail open)
      console.error("Guardian output check failed:", error);
      return { decision: "pass", failedChecks: [] };
    }
  }

  /**
   * Map failed checks to safe replacement messages.
   */
  private getReplacementMessage(failedChecks: string[]): string {
    if (failedChecks.some((c) => c.includes("Restriction signal"))) {
      return "restriction_detected";
    }
    if (failedChecks.some((c) => c.includes("Weight"))) {
      return "weight_language_child";
    }
    if (failedChecks.some((c) => c.includes("Health advice"))) {
      return "health_advice_unsourced";
    }
    if (failedChecks.some((c) => c.includes("Banned"))) {
      return "banned_copy_detected";
    }
    return "fallback_safe_message";
  }

  /**
   * Get a safe fallback message.
   */
  static getSafeMessage(messageId: string): string {
    return SAFE_FALLBACK_MESSAGES[messageId] || SAFE_FALLBACK_MESSAGES["banned_copy_detected"];
  }

  /**
   * Get decision logs for eval suite.
   */
  getDecisionLogs(): GuardianDecisionRecord[] {
    return this.decisionLog.getDecisions();
  }

  /**
   * Get eval metrics.
   */
  getEvalMetrics(): {
    totalChecks: number;
    blocked: number;
    replaced: number;
    passed: number;
    blockRate: number;
    falseBlockRate: number;
  } {
    const logs = this.decisionLog.getDecisions();
    const blocked = logs.filter((l) => l.decision === "block").length;
    const replaced = logs.filter((l) => l.decision === "replace").length;
    const passed = logs.filter((l) => l.decision === "pass").length;

    return {
      totalChecks: logs.length,
      blocked,
      replaced,
      passed,
      blockRate: logs.length > 0 ? blocked / logs.length : 0,
      falseBlockRate: this.decisionLog.getFalseBlockRate(),
    };
  }
}

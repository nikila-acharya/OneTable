/**
 * WP-4.2 — Safety Guardian: Deterministic safety checks and LLM-based input/output guarding.
 * Runs on every user message (SG04 input guard), every outgoing message (7.3 output guard),
 * and every proposal (health advice, missing sources).
 * Returns: pass | block(reason) | replace_with(message_id)
 */

/**
 * Guardian decision types.
 */
export type GuardianDecision = "pass" | "block" | "replace";

export interface GuardianDecisionRecord {
  id: string;
  timestamp: string;
  messageId: string;
  checkType: "input" | "output" | "proposal";
  decision: GuardianDecision;
  reason?: string;
  replacementMessageId?: string;
  failedChecks: string[];
}

/**
 * SG04 — Eating disorder signal detection (input guard).
 * Detects restriction language before agent sees it.
 */
export const RESTRICTION_SIGNALS = [
  // Direct restriction requests
  "eat less",
  "lose weight",
  "burn off",
  "reduce calories",
  "cut down",
  "limit their food",
  "stop eating",

  // Concern language linked to children
  "my.*child.*fat",
  "my.*child.*overweight",
  "my.*child.*chubby",
  "my.*kid.*calories",
  "my.*daughter.*small",
  "my.*son.*weight",

  // Eating disorder warning phrases
  "restrict their diet",
  "extreme diet",
  "no carbs",
  "fasting",
  "detox",
  "cleanse",
];

/**
 * SG-F — Banned copy list (Section 6.4 + diet-culture terms).
 * Applied to all outgoing messages before display.
 */
export const BANNED_COPY = [
  // Diet-culture terms
  "guilt-free",
  "cheat meal",
  "cheat day",
  "clean eating",
  "dirty food",
  "sinful",
  "indulge",
  "treat yourself",
  "earn your meal",
  "work it off",

  // Disease management (stay on FDA general wellness)
  "manage your diabetes",
  "treat.*condition",
  "cure.*disease",
  "insulin.*dosing",
  "carb.*target",
  "manage.*blood sugar",

  // Health claims (general wellness only)
  "proven to.*cure",
  "scientifically.*lose weight",
  "guaranteed.*result",

  // Shame language
  "junk food",
  "bad food",
  "naughty",
  "lazy",
];

/**
 * Deterministic safety rule checker.
 */
export class DeterministicSafetyChecker {
  /**
   * Check for SG04 restriction signals in user input.
   */
  static checkRestrictionSignals(
    message: string,
    householdMembers: Array<{ memberId: string; name: string; birthYear: number }>,
  ): { found: boolean; signal?: string; affectedMemberId?: string } {
    const lowercaseMsg = message.toLowerCase();

    for (const signal of RESTRICTION_SIGNALS) {
      const regex = new RegExp(signal, "i");
      if (regex.test(lowercaseMsg)) {
        // Check if it mentions a member under 18
        const underAge = householdMembers.filter((m) => {
          const age = new Date().getFullYear() - m.birthYear;
          return age < 18;
        });

        // Check if message refers to that member
        for (const member of underAge) {
          if (
            lowercaseMsg.includes(member.name.toLowerCase()) ||
            (signal.includes("child") || signal.includes("daughter") || signal.includes("son"))
          ) {
            return {
              found: true,
              signal,
              affectedMemberId: member.memberId,
            };
          }
        }

        // Check for general restriction language
        if (signal.includes("lose weight") || signal.includes("eat less")) {
          return { found: true, signal };
        }
      }
    }

    return { found: false };
  }

  /**
   * Check for banned copy in outgoing message (7.3 message guard).
   */
  static checkBannedCopy(message: string): { found: boolean; terms?: string[] } {
    const foundTerms: string[] = [];

    for (const term of BANNED_COPY) {
      const regex = new RegExp(`\\b${term}\\b`, "i");
      if (regex.test(message)) {
        foundTerms.push(term);
      }
    }

    return {
      found: foundTerms.length > 0,
      terms: foundTerms,
    };
  }

  /**
   * Check for under-18 weight/calorie language.
   * No weight or calorie-deficit language in any sentence referring to a member under 18.
   */
  static checkUnder18WeightLanguage(
    message: string,
    householdMembers: Array<{ memberId: string; name: string; birthYear: number }>,
  ): { found: boolean; memberName?: string } {
    const underAgeMembers = householdMembers.filter((m) => {
      const age = new Date().getFullYear() - m.birthYear;
      return age < 18;
    });

    const sentences = message.split(/[.!?]/);
    const weightLanguageTerms = [
      "weight",
      "calories",
      "calorie",
      "deficit",
      "BMI",
      "body mass",
      "skinny",
      "fat",
      "overweight",
      "underweight",
      "slim down",
      "slim",
      "lose weight",
      "gain weight",
    ];

    for (const sentence of sentences) {
      const lowercaseSentence = sentence.toLowerCase();

      // Check if sentence has weight language
      const hasWeightLanguage = weightLanguageTerms.some((term) =>
        lowercaseSentence.includes(term),
      );

      if (hasWeightLanguage) {
        // Check if it mentions an under-18 member
        for (const member of underAgeMembers) {
          if (lowercaseSentence.includes(member.name.toLowerCase())) {
            return {
              found: true,
              memberName: member.name,
            };
          }
        }
      }
    }

    return { found: false };
  }

  /**
   * Check for health advice without proper sourcing.
   * Medical or condition-specific advice must have a source.
   */
  static checkHealthAdviceWithoutSource(
    message: string,
  ): { found: boolean; adviceText?: string } {
    const healthAdvicePatterns = [
      /should\s+(?:eat|avoid|reduce|increase).+(?:for|because|due to)/i,
      /if\s+you\s+have.+you\s+should/i,
      /people\s+with.+need\s+to/i,
      /recommended\s+intake.*(?:daily|per week)/i,
    ];

    const sourcePatterns = [
      /according to/i,
      /research shows/i,
      /studies (?:show|indicate|suggest)/i,
      /USDA/,
      /FDA/,
      /American Heart/i,
      /WHO/,
      /source:/i,
      /\\[.*\\]/,
    ];

    for (const pattern of healthAdvicePatterns) {
      const match = message.match(pattern);
      if (match) {
        // Check if there's a source nearby (within 50 chars)
        const context = message.substring(Math.max(0, match.index! - 50), match.index! + 100);
        const hasSource = sourcePatterns.some((sp) => sp.test(context));

        if (!hasSource) {
          return {
            found: true,
            adviceText: match[0],
          };
        }
      }
    }

    return { found: false };
  }
}

/**
 * Safe fallback messages for various blocks.
 */
export const SAFE_FALLBACK_MESSAGES: Record<string, string> = {
  restriction_detected: `I'm here to help your family enjoy meals together. If you have concerns about nutrition or health, I'd recommend speaking with your doctor or a registered dietitian. 

For support with eating concerns, the National Eating Disorders Association (NEDA) has helpful resources at nationaleatingdisorders.org.`,

  health_advice_unsourced: `I can help you plan meals based on your family's preferences and allergies. For personalized nutrition advice, please talk with your doctor or a registered dietitian.`,

  weight_language_child: `I focus on helping your family enjoy meals that work for everyone. All children deserve meals without worry about weight or calories.`,

  banned_copy_detected: `I need to rephrase that. Let me try again: I'm here to help your family enjoy nutritious, delicious meals together.`,
};

/**
 * Guardian decision logger.
 */
export class GuardianDecisionLog {
  private decisions: GuardianDecisionRecord[] = [];

  /**
   * Record a guardian decision.
   */
  recordDecision(record: Omit<GuardianDecisionRecord, "id" | "timestamp">): GuardianDecisionRecord {
    const full: GuardianDecisionRecord = {
      ...record,
      id: `guard-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: new Date().toISOString(),
    };

    this.decisions.push(full);
    return full;
  }

  /**
   * Get all decisions for a household (for eval suite).
   */
  getDecisions(householdId?: string): GuardianDecisionRecord[] {
    return this.decisions;
  }

  /**
   * Get decisions by type (input, output, proposal).
   */
  getDecisionsByType(type: "input" | "output" | "proposal"): GuardianDecisionRecord[] {
    return this.decisions.filter((d) => d.checkType === type);
  }

  /**
   * Get blocked decisions.
   */
  getBlocked(): GuardianDecisionRecord[] {
    return this.decisions.filter((d) => d.decision === "block");
  }

  /**
   * False-block rate (replacements and passes that might have been too cautious).
   */
  getFalseBlockRate(): number {
    if (this.decisions.length === 0) return 0;
    const falseBlocks = this.decisions.filter((d) => d.decision === "replace").length;
    return falseBlocks / this.decisions.length;
  }

  /**
   * Block recall (should catch all actual unsafe messages).
   */
  getBlockRecall(): { blocked: number; total: number; rate: number } {
    const total = this.decisions.length;
    const blocked = this.decisions.filter((d) => d.decision === "block").length;
    return {
      blocked,
      total,
      rate: total > 0 ? blocked / total : 0,
    };
  }
}

/**
 * Proposal checker for P-level actions.
 */
export class ProposalChecker {
  /**
   * Check a proposal (plan diff, approval card) for safety issues.
   */
  static checkProposal(proposal: {
    title?: string;
    diff?: Record<string, unknown>;
    summary?: string;
    healthImpact?: boolean;
  }): {
    safe: boolean;
    issues: string[];
  } {
    const issues: string[] = [];
    const text = `${proposal.title || ""} ${proposal.summary || ""}`;

    // Check for health advice without source
    const healthAdviceCheck = DeterministicSafetyChecker.checkHealthAdviceWithoutSource(text);
    if (healthAdviceCheck.found) {
      issues.push(`Health advice without source: "${healthAdviceCheck.adviceText}"`);
    }

    // Check for banned copy
    const bannedCopyCheck = DeterministicSafetyChecker.checkBannedCopy(text);
    if (bannedCopyCheck.found) {
      issues.push(`Banned terms found: ${bannedCopyCheck.terms?.join(", ")}`);
    }

    // Check for missing allergen sources in plan diff
    if (proposal.diff && proposal.healthImpact) {
      // If proposal changes a meal for a member with allergies, must include reason
      if (!text.includes("allergy") && !text.includes("safe")) {
        issues.push("Plan change affecting member without explaining allergen safety");
      }
    }

    return {
      safe: issues.length === 0,
      issues,
    };
  }
}

/**
 * Fixed clinician message for health advice.
 */
export const CLINICIAN_CONFIRM_MESSAGE = `For personalized nutrition or health advice, please consult with your doctor or a registered dietitian. I can help you plan meals based on your family's preferences, allergies, and general dietary patterns.`;

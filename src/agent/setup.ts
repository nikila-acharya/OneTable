/**
 * WP-4.4 Setup Agent: Conversational member onboarding.
 * Collects allergies, conditions (CKD, diabetes, etc), diet preferences (vegetarian, cuisines),
 * time/skill constraints via conversational LLM-generated prompts.
 * Stores results in context.memory as member_profile.
 * Respects SG01 condition gate (CKD → general_guidance mode).
 */

import { ALLERGENS, CONDITIONS, type Allergen, type Condition } from "../lib/health/enums";
import { DIET_PATTERNS, type DietPattern } from "../lib/members/types";
import { LLMClient, type AgentExecutionContext } from "./runtime";
import { evaluateConditionGate } from "../lib/conditions/gate";

export interface MemberProfile {
  allergies: readonly Allergen[];
  conditions: readonly Condition[];
  diet_pref: readonly DietPattern[];
  cuisines?: readonly string[];
  time_minutes?: number;
  skill_level?: "beginner" | "intermediate" | "advanced";
  constraints?: readonly string[];
}

export interface ConversationState {
  stage: "allergies" | "conditions" | "diet" | "constraints" | "complete";
  responses: Record<string, unknown>;
  validationErrors: string[];
}

export class SetupAgent {
  private llm: LLMClient;
  private conversationState: ConversationState;

  constructor(private context: AgentExecutionContext) {
    this.llm = new LLMClient();
    this.conversationState = {
      stage: "allergies",
      responses: {},
      validationErrors: [],
    };
  }

  /**
   * Start the onboarding conversation flow.
   * Returns conversational prompt for the first question.
   */
  async startConversation(): Promise<string> {
    this.conversationState.stage = "allergies";
    return this.generateAllergyQuestion();
  }

  /**
   * Process user input and advance conversation state.
   * Returns next question or completion message.
   */
  async processInput(userInput: string): Promise<{ prompt: string; complete: boolean }> {
    const { stage } = this.conversationState;

    switch (stage) {
      case "allergies":
        return this.processAllergyInput(userInput);
      case "conditions":
        return this.processConditionInput(userInput);
      case "diet":
        return this.processDietInput(userInput);
      case "constraints":
        return this.processConstraintInput(userInput);
      case "complete":
        return { prompt: "Onboarding complete", complete: true };
      default:
        throw new Error(`Unknown stage: ${stage}`);
    }
  }

  /**
   * Get the current member profile from stored responses.
   */
  getProfile(): MemberProfile {
    const allergies = this.conversationState.responses.allergies ?? [];
    const conditions = this.conversationState.responses.conditions ?? [];

    // Check SG01 gate: only recognised conditions were stored, so the gate sees
    // a clean list. Rejected text never reaches it.
    const gateResult = evaluateConditionGate(this.context.userId, conditions as readonly unknown[]);
    if (gateResult.mode === "general_guidance") {
      this.context.memory.gate_mode = "general_guidance";
      this.context.memory.triggered_conditions = gateResult.triggers;
    }

    return {
      allergies: allergies as Allergen[],
      conditions: conditions as Condition[],
      diet_pref: (this.conversationState.responses.diet_pref ?? []) as readonly DietPattern[],
      cuisines: this.conversationState.responses.cuisines as string[] | undefined,
      time_minutes: this.conversationState.responses.time_minutes as number | undefined,
      skill_level: this.conversationState.responses.skill_level as "beginner" | "intermediate" | "advanced" | undefined,
      constraints: this.conversationState.responses.constraints as string[] | undefined,
    };
  }

  /**
   * Store profile in context memory.
   */
  storeProfile(): void {
    const profile = this.getProfile();
    this.context.memory.member_profile = profile;
  }

  // --- Private conversation stage handlers ---

  private async generateAllergyQuestion(): Promise<string> {
    const allergenList = ALLERGENS.join(", ");
    return `Hello! Let's get started with your food allergies.\n\nDo you have any allergies to these common allergens?\n${allergenList}\n\nPlease list any allergies (or say "none" if you don't have any).`;
  }

  private async processAllergyInput(input: string): Promise<{ prompt: string; complete: boolean }> {
    const parsed = this.matchEnum(input, ALLERGENS);
    this.conversationState.responses.allergies = parsed.matched;

    // Validate allergies against what the user actually typed
    const invalidAllergies = parsed.unknown;

    if (invalidAllergies.length > 0) {
      this.conversationState.validationErrors.push(
        `Unknown allergen(s): ${invalidAllergies.join(", ")}. Please use only the listed allergens.`,
      );
      return {
        prompt: `I didn't recognize some allergens: ${invalidAllergies.join(", ")}.\n\nPlease re-enter from: ${ALLERGENS.join(", ")}\nOr say "none".`,
        complete: false,
      };
    }

    this.conversationState.stage = "conditions";
    return { prompt: await this.generateConditionQuestion(), complete: false };
  }

  private async generateConditionQuestion(): Promise<string> {
    const conditionList = CONDITIONS.filter((c) => c !== "other").join(", ");
    return `Great! Now let's discuss any medical conditions.\n\nDo you have any of these conditions?\n${conditionList}\n\nPlease list any conditions (or say "none").`;
  }

  private async processConditionInput(input: string): Promise<{ prompt: string; complete: boolean }> {
    const parsedConditions = this.matchEnum(input, CONDITIONS);
    this.conversationState.responses.conditions = parsedConditions.matched;

    // Validate conditions first: gating on a half-parsed answer would switch the
    // member into general-guidance mode over text that was rejected anyway.
    const invalidConditions = parsedConditions.unknown;
    const gateResult = evaluateConditionGate(
      this.context.userId,
      parsedConditions.matched,
    );

    if (invalidConditions.length > 0) {
      this.conversationState.validationErrors.push(
        `Unknown condition(s): ${invalidConditions.join(", ")}`,
      );
      return {
        prompt: `I didn't recognize some conditions: ${invalidConditions.join(", ")}.\n\nPlease use: ${CONDITIONS.join(", ")}\nOr say "none".`,
        complete: false,
      };
    }

    // If critical condition detected, note mode switch
    if (gateResult.mode === "general_guidance") {
      this.context.memory.gate_mode = "general_guidance";
      this.context.memory.triggered_conditions = gateResult.triggers;
    }

    this.conversationState.stage = "diet";
    return { prompt: await this.generateDietQuestion(), complete: false };
  }

  private async generateDietQuestion(): Promise<string> {
    const dietList = DIET_PATTERNS.join(", ");
    return `Now let's explore your diet preferences.\n\nWhich of these diet patterns apply to you?\n${dietList}\n\nPlease list any that apply (or say "none").`;
  }

  private async processDietInput(input: string): Promise<{ prompt: string; complete: boolean }> {
    const parsedDiets = this.matchEnum(input, DIET_PATTERNS);
    this.conversationState.responses.diet_pref = parsedDiets.matched;

    // Validate diet patterns against the raw answer
    const invalidDiets = parsedDiets.unknown;

    if (invalidDiets.length > 0) {
      this.conversationState.validationErrors.push(
        `Unknown diet pattern(s): ${invalidDiets.join(", ")}`,
      );
      return {
        prompt: `I didn't recognize: ${invalidDiets.join(", ")}.\n\nPlease use: ${DIET_PATTERNS.join(", ")}\nOr say "none".`,
        complete: false,
      };
    }

    this.conversationState.stage = "constraints";
    return { prompt: await this.generateConstraintQuestion(), complete: false };
  }

  private async generateConstraintQuestion(): Promise<string> {
    return `Finally, let's understand your cooking constraints.\n\nHow much time do you typically have for meal prep? (e.g., "30 minutes", "1 hour")\n\nWhat's your cooking skill level? (beginner, intermediate, advanced)`;
  }

  private async processConstraintInput(input: string): Promise<{ prompt: string; complete: boolean }> {
    const constraints = this.parseConstraints(input);
    this.conversationState.responses.time_minutes = constraints.timeMinutes;
    this.conversationState.responses.skill_level = constraints.skillLevel;
    this.conversationState.responses.constraints = constraints.other;

    // Validate skill level
    const validSkills = ["beginner", "intermediate", "advanced"];
    if (constraints.skillLevel && !validSkills.includes(constraints.skillLevel)) {
      this.conversationState.validationErrors.push(
        `Invalid skill level: ${constraints.skillLevel}. Use: beginner, intermediate, or advanced.`,
      );
      return {
        prompt: `Please specify skill level as: ${validSkills.join(", ")}`,
        complete: false,
      };
    }

    // Reject unrecognised text instead of accepting the turn as complete.
    if (constraints.other.length > 0) {
      this.conversationState.validationErrors.push(
        `Unrecognised constraint(s): ${constraints.other.join(", ")}`,
      );
      return {
        prompt:
          `I didn't recognize: ${constraints.other.join(", ")}.\n\n` +
          `Tell me your prep time (e.g. "30 minutes") and skill level: ${validSkills.join(", ")}.`,
        complete: false,
      };
    }

    // Validate time is a positive number
    if (constraints.timeMinutes !== undefined && constraints.timeMinutes <= 0) {
      this.conversationState.validationErrors.push(
        `Invalid time: ${constraints.timeMinutes}. Please enter a positive number.`,
      );
      return {
        prompt: `Please enter a positive number of minutes.`,
        complete: false,
      };
    }

    this.conversationState.stage = "complete";
    this.storeProfile();

    return {
      prompt: `Perfect! I've recorded your preferences. Here's what we have:\n${this.summarizeProfile()}`,
      complete: true,
    };
  }

  // --- Private parsing helpers ---

  /**
   * Match a free-text answer against a fixed enum.
   *
   * The previous implementation filtered the enum by substring, which threw
   * unrecognised tokens away — so "peanuts, mystery-allergen" validated clean and
   * the conversation advanced. Unknown tokens are now returned so each stage can
   * reject them, and matches keep the order the user wrote them in (the profile
   * test asserts input order, not enum order).
   */
  private matchEnum<T extends string>(
    input: string,
    allowed: readonly T[],
  ): { matched: T[]; unknown: string[] } {
    const matched: T[] = [];
    const unknown: string[] = [];
    if (!input || input.trim().toLowerCase() === "none") return { matched, unknown };

    for (const raw of input.split(/[,;\n]|\s+and\s+/i)) {
      const token = raw.trim().toLowerCase();
      if (!token || token === "none") continue;

      const exact = allowed.find((value) => value.toLowerCase() === token);
      if (exact) {
        if (!matched.includes(exact)) matched.push(exact);
        continue;
      }
      // Multi-word enum values arrive inside a longer phrase ("allergic to peanuts").
      const contained = allowed.find((value) => token.includes(value.toLowerCase()));
      if (contained) {
        if (!matched.includes(contained)) matched.push(contained);
        continue;
      }
      unknown.push(token);
    }
    return { matched, unknown };
  }

  private parseAllergies(input: string): Allergen[] {
    return this.matchEnum(input, ALLERGENS).matched;
  }

  private parseConditions(input: string): Condition[] {
    return this.matchEnum(input, CONDITIONS).matched;
  }

  private parseDiet(input: string): DietPattern[] {
    return this.matchEnum(input, DIET_PATTERNS).matched;
  }

  private parseConstraints(
    input: string,
  ): {
    timeMinutes?: number;
    skillLevel?: "beginner" | "intermediate" | "advanced";
    other: string[];
  } {
    const result = { timeMinutes: undefined as number | undefined, skillLevel: undefined as "beginner" | "intermediate" | "advanced" | undefined, other: [] as string[] };

    const lowerInput = input.toLowerCase();

    // Extract time from patterns like "30 minutes", "1 hour", etc.
    const timeMatch = input.match(/(\d+)\s*(minutes?|hours?)/i);
    if (timeMatch) {
      let minutes = parseInt(timeMatch[1]!, 10);
      if (timeMatch[2]!.toLowerCase().startsWith("hour")) {
        minutes *= 60;
      }
      result.timeMinutes = minutes;
    }

    // Extract skill level
    if (lowerInput.includes("beginner")) result.skillLevel = "beginner";
    else if (lowerInput.includes("intermediate")) result.skillLevel = "intermediate";
    else if (lowerInput.includes("advanced")) result.skillLevel = "advanced";

    // Anything left over after time and skill is unparseable at this stage.
    // The question asks for exactly two things, so the remainder is collected
    // here and the caller rejects the turn rather than storing junk as a
    // constraint: "30 minutes, unknown-skill" used to be accepted as complete.
    const leftover = input
      .split(/[,;]/)
      .map((s) => s.trim().toLowerCase())
      .filter(
        (s) =>
          s.length > 0 &&
          s !== "none" &&
          !/^\d+\s*(minute|minutes|hour|hours)$/.test(s) &&
          !/^(beginner|intermediate|advanced)$/.test(s),
      );

    result.other = leftover;

    return result;
  }

  private summarizeProfile(): string {
    const profile = this.getProfile();
    const lines: string[] = [];

    if (profile.allergies.length > 0) {
      lines.push(`✓ Allergies: ${profile.allergies.join(", ")}`);
    } else {
      lines.push(`✓ No allergies`);
    }

    if (profile.conditions.length > 0) {
      lines.push(`✓ Conditions: ${profile.conditions.join(", ")}`);
    } else {
      lines.push(`✓ No medical conditions`);
    }

    if (profile.diet_pref.length > 0) {
      lines.push(`✓ Diet preferences: ${profile.diet_pref.join(", ")}`);
    } else {
      lines.push(`✓ No specific diet pattern`);
    }

    if (profile.time_minutes) {
      lines.push(`✓ Available time: ${profile.time_minutes} minutes`);
    }

    if (profile.skill_level) {
      lines.push(`✓ Cooking skill: ${profile.skill_level}`);
    }

    if (this.context.memory.gate_mode === "general_guidance") {
      lines.push(`⚠ General guidance mode enabled (medical condition detected)`);
    }

    return lines.join("\n");
  }

  /**
   * Get conversation state for testing/debugging.
   */
  getConversationState(): ConversationState {
    return { ...this.conversationState };
  }

  /**
   * Get validation errors.
   */
  getValidationErrors(): string[] {
    return [...this.conversationState.validationErrors];
  }

  /**
   * Clear validation errors.
   */
  clearValidationErrors(): void {
    this.conversationState.validationErrors = [];
  }
}

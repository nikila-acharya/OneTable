/**
 * WP-4.4 Setup Agent: Conversational member onboarding.
 * Collects allergies, conditions (CKD, diabetes, etc), diet preferences (vegetarian, cuisines),
 * time/skill constraints via conversational LLM-generated prompts.
 * Stores results in context.memory as member_profile.
 * Respects SG01 condition gate (CKD → general_guidance mode).
 */

import { ALLERGENS, CONDITIONS, type Allergen, type Condition } from "./health/enums";
import { DIET_PATTERNS, type DietPattern } from "./members/types";
import { LLMClient, type AgentExecutionContext } from "./runtime";
import { evaluateSG01Gate, isCriticalCondition } from "./guardian";

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

    // Check SG01 gate: if CKD or similar, store but mark in context
    const gateResult = evaluateSG01Gate(conditions);
    if (gateResult.mode === "general_guidance") {
      this.context.memory.gate_mode = "general_guidance";
      this.context.memory.triggered_conditions = gateResult.triggeredConditions;
    }

    return {
      allergies: allergies as Allergen[],
      conditions: conditions as Condition[],
      diet_pref: this.conversationState.responses.diet_pref ?? [],
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
    const allergies = this.parseAllergies(input);
    this.conversationState.responses.allergies = allergies;

    // Validate allergies
    const invalidAllergies = allergies.filter(
      (a): a is string => typeof a === "string" && !ALLERGENS.includes(a as Allergen),
    );

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
    const conditions = this.parseConditions(input);
    this.conversationState.responses.conditions = conditions;

    // Check SG01 gate
    const gateResult = evaluateSG01Gate(conditions);

    // Validate conditions
    const invalidConditions = conditions.filter(
      (c): c is string => typeof c === "string" && !CONDITIONS.includes(c as Condition),
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
      this.context.memory.triggered_conditions = gateResult.triggeredConditions;
    }

    this.conversationState.stage = "diet";
    return { prompt: await this.generateDietQuestion(), complete: false };
  }

  private async generateDietQuestion(): Promise<string> {
    const dietList = DIET_PATTERNS.join(", ");
    return `Now let's explore your diet preferences.\n\nWhich of these diet patterns apply to you?\n${dietList}\n\nPlease list any that apply (or say "none").`;
  }

  private async processDietInput(input: string): Promise<{ prompt: string; complete: boolean }> {
    const diets = this.parseDiet(input);
    this.conversationState.responses.diet_pref = diets;

    // Validate diet patterns
    const invalidDiets = diets.filter(
      (d): d is string => typeof d === "string" && !DIET_PATTERNS.includes(d as DietPattern),
    );

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

  private parseAllergies(input: string): Allergen[] {
    if (!input || input.toLowerCase() === "none") return [];

    const lowerInput = input.toLowerCase();
    return ALLERGENS.filter((allergen) => lowerInput.includes(allergen));
  }

  private parseConditions(input: string): Condition[] {
    if (!input || input.toLowerCase() === "none") return [];

    const lowerInput = input.toLowerCase();
    return CONDITIONS.filter((condition) => lowerInput.includes(condition));
  }

  private parseDiet(input: string): DietPattern[] {
    if (!input || input.toLowerCase() === "none") return [];

    const lowerInput = input.toLowerCase();
    return DIET_PATTERNS.filter((diet) => lowerInput.includes(diet));
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

    // Collect other constraints as strings
    const constraints = input.split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 0 && !s.match(/\d+\s*(minute|hour)/i) && !s.match(/(beginner|intermediate|advanced)/i));

    result.other = constraints;

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

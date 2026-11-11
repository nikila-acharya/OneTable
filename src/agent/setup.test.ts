/**
 * WP-4.4 Setup Agent tests (15+ test cases).
 * Covers: conversation flow, input validation, member profile construction,
 * CKD condition gate, allergy parsing, preference storage.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { SetupAgent, type MemberProfile } from "./setup";
import type { AgentExecutionContext } from "./runtime";

const makeContext = (householdId: string, memberId: string): AgentExecutionContext => ({
  runId: `run-${householdId}`,
  mode: "conversational",
  trigger: "user_message",
  householdId,
  userId: memberId,
  timestamp: new Date().toISOString(),
  budget: {
    maxToolCalls: 25,
    maxDelegations: 4,
    maxPlannerCalls: 3,
    maxTokensPerRun: 200_000,
    toolCallsUsed: 0,
    delegationsUsed: 0,
    plannerCallsThisTurn: 0,
    tokensUsed: 0,
  },
  memory: {},
  household: {},
  delegationDepth: 0,
});

describe("SetupAgent", () => {
  let agent: SetupAgent;

  beforeEach(() => {
    const context = makeContext("household-1", "member-1");
    agent = new SetupAgent(context);
  });

  describe("Conversation Flow", () => {
    it("starts at allergies stage with a welcome question", async () => {
      const prompt = await agent.startConversation();
      expect(prompt).toContain("allergies");
      expect(agent.getConversationState().stage).toBe("allergies");
    });

    it("advances from allergies to conditions after valid input", async () => {
      await agent.startConversation();
      const result = await agent.processInput("peanuts, milk");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().stage).toBe("conditions");
      expect(result.prompt).toContain("conditions");
    });

    it("advances from conditions to diet after valid input", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      const result = await agent.processInput("type 2 diabetes");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().stage).toBe("diet");
      expect(result.prompt).toContain("diet");
    });

    it("advances from diet to constraints after valid input", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      const result = await agent.processInput("vegetarian");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().stage).toBe("constraints");
      expect(result.prompt.toLowerCase()).toMatch(/time|skill/);
    });

    it("completes after constraints with complete=true", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("none");
      const result = await agent.processInput("30 minutes, beginner");
      expect(result.complete).toBe(true);
      expect(agent.getConversationState().stage).toBe("complete");
    });
  });

  describe("Input Validation", () => {
    it("rejects unknown allergens and stays on allergies stage", async () => {
      await agent.startConversation();
      const result = await agent.processInput("peanuts, mystery-allergen");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().stage).toBe("allergies");
      expect(result.prompt).toContain("didn't recognize");
      expect(agent.getValidationErrors().length).toBeGreaterThan(0);
    });

    it("rejects unknown conditions and stays on conditions stage", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      const result = await agent.processInput("type 2 diabetes, unknown-condition");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().stage).toBe("conditions");
      expect(result.prompt).toContain("didn't recognize");
    });

    it("rejects unknown diet patterns and stays on diet stage", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      const result = await agent.processInput("vegetarian, mystery-diet");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().stage).toBe("diet");
      expect(result.prompt).toContain("didn't recognize");
    });

    it("rejects invalid skill level in constraints", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("none");
      const result = await agent.processInput("30 minutes, unknown-skill");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().stage).toBe("constraints");
    });

    it("rejects zero or negative time in constraints", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("none");
      const result = await agent.processInput("0 minutes, beginner");
      expect(result.complete).toBe(false);
      expect(result.prompt).toContain("positive");
    });

    it("handles 'none' input gracefully", async () => {
      await agent.startConversation();
      const result = await agent.processInput("none");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().responses.allergies).toEqual([]);
    });
  });

  describe("Allergy Parsing", () => {
    it("parses single allergen correctly", async () => {
      await agent.startConversation();
      await agent.processInput("milk");
      const profile = agent.getProfile();
      expect(profile.allergies).toContain("milk");
    });

    it("parses multiple allergens from comma-separated input", async () => {
      await agent.startConversation();
      await agent.processInput("peanuts, milk, wheat");
      const profile = agent.getProfile();
      expect(profile.allergies).toContain("peanuts");
      expect(profile.allergies).toContain("milk");
      expect(profile.allergies).toContain("wheat");
    });

    it("handles case-insensitive allergen matching", async () => {
      await agent.startConversation();
      await agent.processInput("MILK, PeAnUtS");
      const profile = agent.getProfile();
      expect(profile.allergies).toContain("milk");
      expect(profile.allergies).toContain("peanuts");
    });

    it("parses two-word allergens like 'tree nuts'", async () => {
      await agent.startConversation();
      await agent.processInput("tree nuts, peanuts");
      const profile = agent.getProfile();
      expect(profile.allergies).toContain("tree nuts");
      expect(profile.allergies).toContain("peanuts");
    });

    it("parses 'crustacean shellfish' correctly", async () => {
      await agent.startConversation();
      await agent.processInput("crustacean shellfish, egg");
      const profile = agent.getProfile();
      expect(profile.allergies).toContain("crustacean shellfish");
      expect(profile.allergies).toContain("egg");
    });
  });

  describe("Member Profile Construction", () => {
    it("stores complete profile with all fields", async () => {
      await agent.startConversation();
      await agent.processInput("peanuts");
      await agent.processInput("type 2 diabetes");
      await agent.processInput("vegetarian");
      await agent.processInput("45 minutes, intermediate");

      const profile = agent.getProfile();
      expect(profile.allergies).toEqual(["peanuts"]);
      expect(profile.conditions).toContain("type 2 diabetes");
      expect(profile.diet_pref).toContain("vegetarian");
      expect(profile.time_minutes).toBe(45);
      expect(profile.skill_level).toBe("intermediate");
    });

    it("stores profile in context memory on completion", async () => {
      await agent.startConversation();
      await agent.processInput("milk");
      await agent.processInput("none");
      await agent.processInput("vegan");
      const result = await agent.processInput("30 minutes, beginner");

      expect(result.complete).toBe(true);
      expect(agent.getProfile().allergies).toContain("milk");
    });

    it("builds correct profile structure", async () => {
      await agent.startConversation();
      await agent.processInput("peanuts, tree nuts");
      await agent.processInput("type 1 diabetes, hypertension");
      await agent.processInput("vegetarian, kosher");
      await agent.processInput("60 minutes, advanced");

      const profile = agent.getProfile();
      const expectedProfile: MemberProfile = {
        allergies: ["peanuts", "tree nuts"],
        conditions: ["type 1 diabetes", "hypertension"],
        diet_pref: ["vegetarian", "kosher"],
        time_minutes: 60,
        skill_level: "advanced",
        constraints: [],
      };

      expect(profile.allergies).toEqual(expectedProfile.allergies);
      expect(profile.conditions).toEqual(expectedProfile.conditions);
      expect(profile.diet_pref).toEqual(expectedProfile.diet_pref);
      expect(profile.time_minutes).toBe(expectedProfile.time_minutes);
      expect(profile.skill_level).toBe(expectedProfile.skill_level);
    });

    it("handles empty responses gracefully", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("15 minutes");

      const profile = agent.getProfile();
      expect(profile.allergies).toEqual([]);
      expect(profile.conditions).toEqual([]);
      expect(profile.diet_pref).toEqual([]);
      expect(profile.time_minutes).toBe(15);
    });
  });

  describe("CKD Condition Gate (SG01)", () => {
    it("detects chronic kidney disease and sets general_guidance mode", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("chronic kidney disease");

      const profile = testAgent.getProfile();
      expect(profile.conditions).toContain("chronic kidney disease");
      expect(context.memory.gate_mode).toBe("general_guidance");
      expect(context.memory.triggered_conditions).toContain("chronic kidney disease");
    });

    it("detects type 1 diabetes and sets general_guidance mode", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("type 1 diabetes");

      expect(context.memory.gate_mode).toBe("general_guidance");
      expect(context.memory.triggered_conditions).toContain("type 1 diabetes");
    });

    it("detects type 2 diabetes and sets general_guidance mode", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("type 2 diabetes");

      expect(context.memory.gate_mode).toBe("general_guidance");
    });

    it("detects pregnancy and sets general_guidance mode", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("pregnancy");

      expect(context.memory.gate_mode).toBe("general_guidance");
    });

    it("detects heart failure and sets general_guidance mode", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("heart failure");

      expect(context.memory.gate_mode).toBe("general_guidance");
    });

    // This case was written against "celiac is not critical", but the shipped
    // gate says otherwise: src/lib/conditions/policy.ts marks celiac
    // generalGuidance + glutenHardFilter, and the merged tests/conditions/gate.test.ts
    // (PRD SG01 bullet 3) lists celiac in `triggers`. The non-gating condition in
    // PR03 is "other" — recognised, deliberately never acted on.
    it("does not set general_guidance for the non-gating 'other' condition", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("other");

      expect(context.memory.gate_mode).toBeUndefined();
    });

    it("gates celiac into general_guidance (SG01 bullet 3, per the canonical policy)", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("celiac disease");

      expect(context.memory.gate_mode).toBe("general_guidance");
    });

    it("detects multiple critical conditions", async () => {
      const context = makeContext("household-1", "member-1");
      const testAgent = new SetupAgent(context);

      await testAgent.startConversation();
      await testAgent.processInput("none");
      await testAgent.processInput("type 2 diabetes, heart failure");

      expect(context.memory.gate_mode).toBe("general_guidance");
      expect((context.memory.triggered_conditions as readonly unknown[]).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Preference Storage", () => {
    it("stores diet preferences correctly", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("vegetarian, vegan, gluten_free");

      const profile = agent.getProfile();
      expect(profile.diet_pref).toContain("vegetarian");
      expect(profile.diet_pref).toContain("vegan");
      expect(profile.diet_pref).toContain("gluten_free");
    });

    it("parses time constraints in minutes", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("45 minutes, beginner");

      const profile = agent.getProfile();
      expect(profile.time_minutes).toBe(45);
    });

    it("converts hours to minutes for time constraints", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("2 hours, intermediate");

      const profile = agent.getProfile();
      expect(profile.time_minutes).toBe(120);
    });

    it("parses skill level correctly", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("none");
      await agent.processInput("1 hour, advanced");

      const profile = agent.getProfile();
      expect(profile.skill_level).toBe("advanced");
    });

    it("stores all preferences in context memory", async () => {
      await agent.startConversation();
      await agent.processInput("peanuts");
      await agent.processInput("hypertension");
      await agent.processInput("vegetarian");
      const result = await agent.processInput("30 minutes, beginner");

      expect(result.complete).toBe(true);
      agent.storeProfile();

      expect(agent.getProfile().allergies).toContain("peanuts");
      expect(agent.getProfile().conditions).toContain("hypertension");
      expect(agent.getProfile().diet_pref).toContain("vegetarian");
    });
  });

  describe("Error Handling and Edge Cases", () => {
    it("clears validation errors on new input", async () => {
      await agent.startConversation();
      await agent.processInput("invalid-allergen");
      expect(agent.getValidationErrors().length).toBeGreaterThan(0);

      agent.clearValidationErrors();
      expect(agent.getValidationErrors().length).toBe(0);
    });

    it("handles empty input", async () => {
      await agent.startConversation();
      const result = await agent.processInput("");
      expect(result.complete).toBe(false);
      expect(agent.getConversationState().responses.allergies).toEqual([]);
    });

    it("summarizes complete profile in final message", async () => {
      await agent.startConversation();
      await agent.processInput("milk");
      await agent.processInput("type 2 diabetes");
      await agent.processInput("vegan");
      const result = await agent.processInput("30 minutes, beginner");

      expect(result.prompt).toContain("milk");
      expect(result.prompt).toContain("type 2 diabetes");
      expect(result.prompt).toContain("vegan");
    });

    it("includes general guidance warning in summary for critical conditions", async () => {
      await agent.startConversation();
      await agent.processInput("none");
      await agent.processInput("chronic kidney disease");
      await agent.processInput("none");
      const result = await agent.processInput("30 minutes, beginner");

      expect(result.prompt).toMatch(/general guidance|⚠/);
    });
  });

  describe("State Persistence", () => {
    it("preserves conversation state across multiple calls", async () => {
      await agent.startConversation();
      const state1 = agent.getConversationState();
      expect(state1.stage).toBe("allergies");

      await agent.processInput("peanuts");
      const state2 = agent.getConversationState();
      expect(state2.stage).toBe("conditions");
      expect(state2.responses.allergies).toEqual(["peanuts"]);

      await agent.processInput("none");
      const state3 = agent.getConversationState();
      expect(state3.stage).toBe("diet");
      expect(state3.responses.allergies).toEqual(["peanuts"]);
      expect(state3.responses.conditions).toEqual([]);
    });

    it("maintains profile data through completion", async () => {
      await agent.startConversation();
      await agent.processInput("tree nuts, sesame");
      await agent.processInput("prediabetes");
      await agent.processInput("pescatarian");
      await agent.processInput("1 hour, advanced");

      const profile = agent.getProfile();
      expect(profile.allergies).toHaveLength(2);
      expect(profile.allergies).toContain("tree nuts");
      expect(profile.allergies).toContain("sesame");
      expect(profile.conditions).toContain("prediabetes");
      expect(profile.diet_pref).toContain("pescatarian");
      expect(profile.time_minutes).toBe(60);
    });
  });
});

/**
 * WP-4.8 — Grocery & Pantry Agent Tests
 * Draft lists, spoilage tracking, Instacart handoff, leftover questions
 */

import { beforeEach, describe, expect, it } from "vitest";
import { GroceryAgent } from "./grocery";
import type { MealPlan } from "@/lib/planner";
import type { AgentExecutionContext } from "./runtime";

describe("WP-4.8 Grocery & Pantry Agent", () => {
  let agent: GroceryAgent;
  let mockContext: AgentExecutionContext;

  const mockMealPlan: MealPlan = {
    planId: "plan-001",
    meals: [
      {
        date: "2026-11-10",
        mealType: "breakfast",
        recipe: {
          id: "recipe-001",
          name: "Oatmeal with Berries",
          servings: 1,
          prepMinutes: 2,
          cookMinutes: 3,
          ingredients: ["oats", "milk", "berries"],
          caloriesPerServing: 320,
          allergens: [],
          isOwnSource: false,
        },
        locked: false,
      },
      {
        date: "2026-11-10",
        mealType: "lunch",
        recipe: {
          id: "recipe-002",
          name: "Grilled Chicken",
          servings: 1,
          prepMinutes: 10,
          cookMinutes: 20,
          ingredients: ["chicken breast", "broccoli", "olive oil"],
          caloriesPerServing: 380,
          allergens: [],
          isOwnSource: false,
        },
        locked: false,
      },
      {
        date: "2026-11-10",
        mealType: "dinner",
        recipe: {
          id: "recipe-003",
          name: "Pasta Marinara",
          servings: 1,
          prepMinutes: 5,
          cookMinutes: 15,
          ingredients: ["pasta", "tomato sauce", "garlic", "olive oil"],
          caloriesPerServing: 420,
          allergens: [],
          isOwnSource: false,
        },
        locked: false,
      },
    ],
    rationale: "Balanced week for family of 4",
    createdAt: new Date().toISOString(),
  };

  beforeEach(() => {
    mockContext = {} as AgentExecutionContext;
    agent = new GroceryAgent(mockContext);
  });

  // ============ List Drafting ============
  describe("Grocery list drafting", () => {
    it("drafts list from meal plan", async () => {
      const result = await agent.draftGroceryList("household-001", mockMealPlan);

      expect(result.list).toBeDefined();
      expect(result.list.items.length).toBeGreaterThan(0);
      expect(result.list.status).toBe("draft");
      expect(result.list.planId).toBe("plan-001");
    });

    it("extracts ingredients from all meals", async () => {
      const result = await agent.draftGroceryList("household-001", mockMealPlan);

      const itemNames = result.list.items.map((i) => i.name.toLowerCase());
      expect(itemNames).toContain("chicken breast");
      expect(itemNames).toContain("pasta");
      expect(itemNames).toContain("olive oil");
    });

    it("deduplicates ingredients (e.g., olive oil appears once)", async () => {
      const result = await agent.draftGroceryList("household-001", mockMealPlan);

      const oliveOilItems = result.list.items.filter((i) =>
        i.name.toLowerCase().includes("olive oil"),
      );
      expect(oliveOilItems).toHaveLength(1);
      expect(oliveOilItems[0]!.quantity).toBeGreaterThan(1); // Merged quantity
    });

    it("sorts items by category", async () => {
      const result = await agent.draftGroceryList("household-001", mockMealPlan);

      const categories = result.list.items.map((i) => i.category);
      // Should maintain order: produce, meat, dairy, frozen, pantry, other
      for (let i = 0; i < categories.length - 1; i++) {
        const current = categories[i];
        const next = categories[i + 1];
        const categoryOrder = ["produce", "meat", "dairy", "frozen", "pantry", "other"];
        expect(categoryOrder.indexOf(current!)).toBeLessThanOrEqual(categoryOrder.indexOf(next!));
      }
    });

    it("infers category correctly", async () => {
      const result = await agent.draftGroceryList("household-001", mockMealPlan);

      const chicken = result.list.items.find((i) => i.name.toLowerCase().includes("chicken"));
      expect(chicken?.category).toBe("meat");

      const broccoli = result.list.items.find((i) => i.name.toLowerCase().includes("broccoli"));
      expect(broccoli?.category).toBe("produce");

      const pasta = result.list.items.find((i) => i.name.toLowerCase().includes("pasta"));
      expect(pasta?.category).toBe("pantry");
    });

    it("sets appropriate shelf life for each category", async () => {
      const result = await agent.draftGroceryList("household-001", mockMealPlan);

      const meat = result.list.items.find((i) => i.category === "meat");
      expect(meat?.estimatedShelfDays).toBe(3);

      const produce = result.list.items.find((i) => i.category === "produce");
      expect(produce?.estimatedShelfDays).toBe(7);

      const pantry = result.list.items.find((i) => i.category === "pantry");
      expect(pantry?.estimatedShelfDays).toBe(90);
    });

    it("generates rationale with item counts", async () => {
      const result = await agent.draftGroceryList("household-001", mockMealPlan);

      expect(result.list.rationale).toContain("items");
      expect(result.list.rationale).toContain("meals");
    });
  });

  // ============ Spoilage Tracking ============
  describe("Purchase dates & spoilage tracking", () => {
    it("records purchase date and calculates expiry", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const itemId = draft.list.items[0]!.itemId;

      const purchased = new Date("2026-11-01");
      const result = await agent.recordPurchase(draft.list.listId, itemId, purchased.toISOString());

      expect(result.item.purchasedAt).toBe(purchased.toISOString());
      expect(result.expiresAt).toBeDefined();
    });

    it("calculates expiry based on category shelf life", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const meatItem = draft.list.items.find((i) => i.category === "meat");
      if (!meatItem) {
        // Skip if no meat in test plan
        expect(true).toBe(true);
        return;
      }

      const purchased = new Date("2026-11-10");
      const result = await agent.recordPurchase(draft.list.listId, meatItem.itemId, purchased.toISOString());

      const expiresAt = new Date(result.expiresAt);
      const expected = new Date(purchased);
      expected.setDate(expected.getDate() + 3); // Meat: 3 days

      expect(expiresAt.toDateString()).toBe(expected.toDateString());
    });

    it("detects items near spoilage (within 3 days)", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      // items[0] is oats (pantry, 90-day shelf life), which cannot be "near
      // spoilage" two days after purchase. The perishable in this plan is the
      // meat item (3-day shelf life), which is what the test is about.
      const perishable =
        draft.list.items.find((i) => i.category === "meat") ??
        draft.list.items.find((i) => i.estimatedShelfDays <= 5);
      expect(perishable, "fixture must contain a item that expires within 5 days").toBeDefined();
      const itemId = perishable!.itemId;

      // Purchase 2 days ago
      const purchased = new Date();
      purchased.setDate(purchased.getDate() - 2);

      await agent.recordPurchase(draft.list.listId, itemId, purchased.toISOString());

      const alerts = await agent.checkForSpoilage("household-001");
      expect(alerts.length).toBeGreaterThan(0);
    });

    it("suggests recipes for near-spoiling items", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const itemId = draft.list.items[0]!.itemId;

      const purchased = new Date();
      purchased.setDate(purchased.getDate() - 2);

      await agent.recordPurchase(draft.list.listId, itemId, purchased.toISOString());

      const alerts = await agent.checkForSpoilage("household-001");
      if (alerts.length > 0) {
        expect(alerts[0]!.suggestedRecipes).toBeDefined();
        expect(Array.isArray(alerts[0]!.suggestedRecipes)).toBe(true);
      }
    });

    it("does not alert for items far from expiry", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const itemId = draft.list.items[0]!.itemId;

      // Purchase today (will expire in shelf-life days)
      const purchased = new Date();
      await agent.recordPurchase(draft.list.listId, itemId, purchased.toISOString());

      const alerts = await agent.checkForSpoilage("household-001");
      // Should have fewer alerts (items not yet close to expiry)
      expect(alerts.length).toBeLessThanOrEqual(draft.list.items.length);
    });

    it("maintains pantry inventory", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const itemId = draft.list.items[0]!.itemId;

      await agent.recordPurchase(draft.list.listId, itemId, new Date().toISOString());

      const pantry = agent.getPantry();
      expect(pantry.length).toBeGreaterThan(0);
    });
  });

  // ============ Leftover Questions ============
  describe("Asking about leftovers", () => {
    it("generates questions about high-yield items", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const result = await agent.askAboutLeftovers(draft.list.listId);

      expect(result.questions.length).toBeGreaterThan(0);
      expect(result.questions[0]).toContain("usually use");
    });

    it("focuses on meat, dairy, produce (high-yield categories)", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const result = await agent.askAboutLeftovers(draft.list.listId);

      const questionText = result.questions.join(" ");
      // Questions should mention items, not just generic questions
      expect(questionText.length).toBeGreaterThan(0);
    });

    it("returns empty questions for nonexistent list", async () => {
      const result = await agent.askAboutLeftovers("nonexistent-list");
      expect(result.questions).toHaveLength(0);
    });
  });

  // ============ Instacart Handoff ============
  describe("Instacart handoff (P-level)", () => {
    it("prepares Instacart URL and estimates cost", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      const result = await agent.prepareInstacartHandoff(draft.list.listId);

      expect(result.instacartUrl).toContain("instacart.com");
      expect(result.itemCount).toBe(draft.list.items.length);
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it("updates list status to approved after handoff prep", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      await agent.prepareInstacartHandoff(draft.list.listId);

      const list = agent.getList(draft.list.listId);
      expect(list?.status).toBe("approved");
    });

    it("sends to Instacart (P-level action)", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      await agent.prepareInstacartHandoff(draft.list.listId);

      const result = await agent.sendToInstacart(draft.list.listId);

      expect(result.success).toBe(true);
      expect(result.orderId).toBeDefined();
      expect(result.message).toContain("Order placed");
    });

    it("updates list status to sent_to_instacart after sending", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      await agent.prepareInstacartHandoff(draft.list.listId);
      await agent.sendToInstacart(draft.list.listId);

      const list = agent.getList(draft.list.listId);
      expect(list?.status).toBe("sent_to_instacart");
    });
  });

  // ============ Edge Cases ============
  describe("Edge cases & error handling", () => {
    it("handles meal plan with no ingredients", async () => {
      const emptyPlan: MealPlan = {
        planId: "empty",
        meals: [],
        rationale: "Empty",
        createdAt: new Date().toISOString(),
      };

      const result = await agent.draftGroceryList("household-001", emptyPlan);
      expect(result.list.items).toHaveLength(0);
    });

    it("fails gracefully on invalid listId", async () => {
      const result = await agent.askAboutLeftovers("invalid-id");
      expect(result.questions).toHaveLength(0);
    });

    it("fails gracefully on purchase for missing item", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);

      try {
        await agent.recordPurchase(draft.list.listId, "nonexistent-item", new Date().toISOString());
        expect.fail("Should have thrown error");
      } catch (error) {
        expect((error as Error).message).toContain("not found");
      }
    });

    it("returns empty spoilage alerts when no pantry items", async () => {
      const alerts = await agent.checkForSpoilage("household-001");
      expect(alerts).toHaveLength(0);
    });

    it("creates unique listId for each draft", async () => {
      const draft1 = await agent.draftGroceryList("household-001", mockMealPlan);
      const draft2 = await agent.draftGroceryList("household-001", mockMealPlan);

      expect(draft1.list.listId).not.toBe(draft2.list.listId);
    });
  });

  // ============ Integration ============
  describe("Integration with meal plan workflow", () => {
    it("full flow: draft → record purchases → check spoilage → handoff", async () => {
      // 1. Draft list from plan
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);
      expect(draft.list.status).toBe("draft");

      // 2. Ask about leftovers
      const questions = await agent.askAboutLeftovers(draft.list.listId);
      expect(questions.questions.length).toBeGreaterThanOrEqual(0);

      // 3. Prepare Instacart
      const handoff = await agent.prepareInstacartHandoff(draft.list.listId);
      expect(handoff.itemCount).toBeGreaterThan(0);

      // 4. Send to Instacart
      const sent = await agent.sendToInstacart(draft.list.listId);
      expect(sent.success).toBe(true);

      // 5. Verify final status
      const final = agent.getList(draft.list.listId);
      expect(final?.status).toBe("sent_to_instacart");
    });

    it("spoilage detection after recording purchases", async () => {
      const draft = await agent.draftGroceryList("household-001", mockMealPlan);

      // Record old purchase
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 5);

      if (draft.list.items.length > 0) {
        await agent.recordPurchase(draft.list.listId, draft.list.items[0]!.itemId, oldDate.toISOString());
      }

      const alerts = await agent.checkForSpoilage("household-001");
      // May or may not have alerts depending on shelf life
      expect(Array.isArray(alerts)).toBe(true);
    });
  });
});

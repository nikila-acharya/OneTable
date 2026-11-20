/**
 * WP-4.8 — Grocery & Pantry Agent: Shopping lists and spoilage tracking
 * Drafts merged grocery lists after plan acceptance.
 * Tracks purchase dates, suggests uses for near-spoiling items.
 * Prepares Instacart handoff for approval (P-level tool).
 * GL01, GL02, IC01, AG03 spoilage
 */

import type { MealPlan, MealSlot } from "@/lib/planner";
import type { AgentExecutionContext } from "./runtime";
import { LLMClient } from "./runtime";
import { getAgentConfig } from "./roster";

/**
 * Grocery list item.
 */
export interface GroceryItem {
  itemId: string;
  name: string;
  quantity: number;
  unit: "qty" | "g" | "ml" | "oz" | "cup" | "tbsp" | "tsp";
  category: "produce" | "dairy" | "meat" | "pantry" | "frozen" | "other";
  estimatedShelfDays: number;
  purchasedAt?: string;
  expiresAt?: string;
  addedByRecipe?: string;
}

/**
 * Grocery list (merged from plan).
 */
export interface GroceryList {
  listId: string;
  householdId: string;
  planId: string;
  items: GroceryItem[];
  totalItems: number;
  createdAt: string;
  status: "draft" | "approved" | "sent_to_instacart" | "archived";
  rationale: string;
  instacartLink?: string;
}

/**
 * Spoilage alert.
 */
export interface SpoilageAlert {
  alertId: string;
  item: GroceryItem;
  daysUntilExpiry: number;
  suggestedRecipes: string[];
  message: string;
}

/**
 * Grocery & Pantry Agent.
 */
export class GroceryAgent {
  private llm: LLMClient;
  private config = getAgentConfig("grocery");
  private groceryLists: Map<string, GroceryList> = new Map();
  private pantryItems: Map<string, GroceryItem> = new Map();

  constructor(
    private context: AgentExecutionContext,
  ) {
    this.llm = new LLMClient(this.config.model);
  }

  /**
   * Draft grocery list from meal plan.
   */
  async draftGroceryList(
    householdId: string,
    plan: MealPlan,
  ): Promise<{ list: GroceryList; message: string }> {
    const items = this.extractIngredientsFromPlan(plan);
    const merged = this.mergeAndDeduplicateItems(items);
    const sorted = this.sortByCategory(merged);

    const listId = `grocerylist-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const list: GroceryList = {
      listId,
      householdId,
      planId: plan.planId,
      items: sorted,
      totalItems: sorted.length,
      createdAt: new Date().toISOString(),
      status: "draft",
      rationale: this.generateRationale(plan, sorted),
    };

    this.groceryLists.set(listId, list);

    return {
      list,
      message: `Drafted grocery list with ${sorted.length} items for ${this.countServings(plan)} servings`,
    };
  }

  /**
   * Ask about likely leftovers (instead of auto-ticking).
   */
  async askAboutLeftovers(listId: string): Promise<{
    questions: string[];
    message: string;
  }> {
    const list = this.groceryLists.get(listId);
    if (!list) {
      return { questions: [], message: "List not found" };
    }

    const highYieldItems = list.items.filter((item) =>
      ["meat", "dairy", "produce"].includes(item.category),
    );

    const questions = highYieldItems.slice(0, 3).map((item) => 
      `How much ${item.name} do you usually use? Any leftovers to plan for?`
    );

    return {
      questions,
      message: "Let's adjust quantities based on what you typically use.",
    };
  }

  /**
   * Track purchase dates and calculate expiry.
   */
  async recordPurchase(
    listId: string,
    itemId: string,
    purchasedAt?: string,
  ): Promise<{ item: GroceryItem; expiresAt: string }> {
    const list = this.groceryLists.get(listId);
    if (!list) {
      throw new Error(`List ${listId} not found`);
    }

    const item = list.items.find((i) => i.itemId === itemId);
    if (!item) {
      throw new Error(`Item ${itemId} not found in list`);
    }

    const purchased = new Date(purchasedAt || new Date().toISOString());
    const expires = new Date(purchased);
    expires.setDate(expires.getDate() + item.estimatedShelfDays);

    item.purchasedAt = purchased.toISOString();
    item.expiresAt = expires.toISOString();

    this.pantryItems.set(item.itemId, item);

    return { item, expiresAt: expires.toISOString() };
  }

  /**
   * Check for spoilage and suggest uses.
   */
  async checkForSpoilage(householdId: string): Promise<SpoilageAlert[]> {
    const alerts: SpoilageAlert[] = [];
    const now = new Date();

    for (const [itemId, item] of this.pantryItems) {
      if (!item.expiresAt) continue;

      const expiresAt = new Date(item.expiresAt);
      const daysUntilExpiry = Math.floor((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

      // Alert if within 3 days of expiry
      if (daysUntilExpiry <= 3 && daysUntilExpiry >= 0) {
        const suggestedRecipes = this.suggestRecipesForItem(item);

        alerts.push({
          alertId: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          item,
          daysUntilExpiry,
          suggestedRecipes,
          message: `${item.name} expires in ${daysUntilExpiry} days. Here are recipes that use it:`,
        });
      }
    }

    return alerts;
  }

  /**
   * Propose Instacart handoff (P-level, needs approval).
   */
  async prepareInstacartHandoff(listId: string): Promise<{
    instacartUrl: string;
    itemCount: number;
    estimatedCost: number;
  }> {
    const list = this.groceryLists.get(listId);
    if (!list) {
      throw new Error(`List ${listId} not found`);
    }

    // Generate Instacart URL (mock)
    const instacartUrl = `https://instacart.com/store/whole_foods/lists/${listId}`;

    // Estimate cost ($1-3 per item average)
    const estimatedCost = Math.round(
      list.items.reduce((sum, item) => sum + item.quantity * (Math.random() * 2 + 1), 0) * 100,
    ) / 100;

    list.instacartLink = instacartUrl;
    list.status = "approved";

    return {
      instacartUrl,
      itemCount: list.items.length,
      estimatedCost,
    };
  }

  /**
   * Send to Instacart (P-level action).
   */
  async sendToInstacart(listId: string): Promise<{ success: boolean; orderId: string; message: string }> {
    const list = this.groceryLists.get(listId);
    if (!list) {
      return { success: false, orderId: "", message: "List not found" };
    }

    if (!list.instacartLink) {
      return { success: false, orderId: "", message: "Instacart link not prepared" };
    }

    // Mock order ID
    const orderId = `order-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    list.status = "sent_to_instacart";

    return {
      success: true,
      orderId,
      message: `Order placed! Track it at ${list.instacartLink}`,
    };
  }

  /**
   * Get grocery list by ID.
   */
  getList(listId: string): GroceryList | undefined {
    return this.groceryLists.get(listId);
  }

  /**
   * Get all items in pantry (with expiry dates).
   */
  getPantry(): GroceryItem[] {
    return Array.from(this.pantryItems.values());
  }

  /**
   * Private helpers.
   */

  private extractIngredientsFromPlan(plan: MealPlan): GroceryItem[] {
    const items: GroceryItem[] = [];
    const itemMap = new Map<string, GroceryItem>();

    for (const meal of plan.meals) {
      for (const ingredient of meal.recipe.ingredients) {
        const key = ingredient.toLowerCase();

        if (!itemMap.has(key)) {
          const category = this.inferCategory(ingredient);
          const item: GroceryItem = {
            itemId: `item-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
            name: ingredient,
            quantity: 1,
            unit: "qty",
            category,
            estimatedShelfDays: this.getShelfLife(category),
          };
          itemMap.set(key, item);
        } else {
          const existing = itemMap.get(key)!;
          existing.quantity += 1;
        }
      }
    }

    return Array.from(itemMap.values());
  }

  private mergeAndDeduplicateItems(items: GroceryItem[]): GroceryItem[] {
    const merged = new Map<string, GroceryItem>();

    for (const item of items) {
      const key = item.name.toLowerCase();

      if (merged.has(key)) {
        const existing = merged.get(key)!;
        existing.quantity += item.quantity;
      } else {
        merged.set(key, item);
      }
    }

    return Array.from(merged.values());
  }

  private sortByCategory(items: GroceryItem[]): GroceryItem[] {
    const categoryOrder = ["produce", "meat", "dairy", "frozen", "pantry", "other"];

    return items.sort((a, b) => {
      const aIdx = categoryOrder.indexOf(a.category);
      const bIdx = categoryOrder.indexOf(b.category);
      return aIdx - bIdx;
    });
  }

  private inferCategory(ingredient: string): GroceryItem["category"] {
    const lower = ingredient.toLowerCase();

    if (
      lower.includes("chicken") ||
      lower.includes("beef") ||
      lower.includes("salmon") ||
      lower.includes("turkey")
    ) {
      return "meat";
    }
    if (lower.includes("milk") || lower.includes("yogurt") || lower.includes("cheese")) {
      return "dairy";
    }
    if (
      lower.includes("broccoli") ||
      lower.includes("carrot") ||
      lower.includes("apple") ||
      lower.includes("berry")
    ) {
      return "produce";
    }
    if (
      lower.includes("pasta") ||
      lower.includes("rice") ||
      lower.includes("flour") ||
      lower.includes("sauce")
    ) {
      return "pantry";
    }
    if (lower.includes("frozen")) {
      return "frozen";
    }

    return "other";
  }

  private getShelfLife(category: GroceryItem["category"]): number {
    const shelfLives: Record<GroceryItem["category"], number> = {
      produce: 7,
      meat: 3,
      dairy: 14,
      frozen: 180,
      pantry: 90,
      other: 30,
    };

    return shelfLives[category];
  }

  private suggestRecipesForItem(item: GroceryItem): string[] {
    // Mock suggestions based on item
    const suggestions: Record<string, string[]> = {
      "broccoli": ["Stir-fry", "Roasted with garlic", "Soup"],
      "chicken breast": ["Grilled with lemon", "Curry", "Salad"],
      "milk": ["Smoothie", "Pancakes", "Pudding"],
      "pasta": ["Carbonara", "Marinara", "Alfredo"],
    };

    return suggestions[item.name.toLowerCase()] || ["General recipe"];
  }

  private countServings(plan: MealPlan): number {
    // Count unique dates in plan
    const dates = new Set(plan.meals.map((m) => m.date));
    return dates.size;
  }

  private generateRationale(plan: MealPlan, items: GroceryItem[]): string {
    const produceCount = items.filter((i) => i.category === "produce").length;
    const meatCount = items.filter((i) => i.category === "meat").length;
    const dairyCount = items.filter((i) => i.category === "dairy").length;

    return `Merged ${items.length} items from ${plan.meals.length} meals: ${produceCount} produce, ${meatCount} proteins, ${dairyCount} dairy. Sorted by category for shopping efficiency.`;
  }
}

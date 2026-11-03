import { describe, it, expect } from 'vitest';
import {
  lockSlot,
  proposeSwap,
  regenerateSlots,
  type LockAction,
  type SwapProposal,
  type RegenerateScope,
} from './modifications';
import type { MealSlot } from './planner';

describe('Lock / swap / regenerate (WP-3.6, MP02)', () => {
  describe('lockSlot: keep a slot when regenerating', () => {
    it('marks a slot as locked so it is not regenerated', () => {
      const locked = lockSlot('slot-id-1');
      expect(locked.locked).toBe(true);
      expect(locked.id).toBe('slot-id-1');
    });

    it('returns the action record for the database', () => {
      const action = lockSlot('slot-1');
      expect(action).toHaveProperty('id');
      expect(action).toHaveProperty('locked');
    });
  });

  describe('proposeSwap: suggest 3 alternatives that pass rules', () => {
    it('returns 3 recipe alternatives for a slot', () => {
      const proposal = proposeSwap(
        {
          id: 'slot-1',
          member_id: 'm1',
          meal_type: 'dinner',
          recipe_id: 'current-recipe',
          date: new Date('2026-11-10'),
          locked: false,
          mode: 'shared',
          plan_id: 'plan-1',
        },
        [
          { id: 'r1', name: 'pasta', meal_types: ['dinner'], energy_kcal: 600, protein_g: 20 },
          { id: 'r2', name: 'steak', meal_types: ['dinner'], energy_kcal: 650, protein_g: 40 },
          { id: 'r3', name: 'tofu', meal_types: ['dinner'], energy_kcal: 400, protein_g: 25 },
        ],
        {
          id: 'm1',
          age: 30,
          sex: 'male' as const,
          allergies: [],
          conditions: [],
          diet_pattern: 'omnivore',
          weight_kg: 80,
          height_cm: 180,
          activity: 'moderate' as const,
        },
        []
      );

      expect(proposal.alternatives).toHaveLength(3);
      expect(proposal.reason).toContain('Pass all rules');
      expect(proposal.slot_id).toBe('slot-1');
    });

    it('AC: swap alternatives never violate a member\'s allergen or condition gate', () => {
      // Property test in WP-3.7; this is a smoke test
      const proposal = proposeSwap(
        {
          id: 'slot-1',
          member_id: 'm1',
          meal_type: 'snack',
          recipe_id: 'nuts',
          date: new Date('2026-11-10'),
          locked: false,
          mode: 'individual',
          plan_id: 'plan-1',
        },
        [
          { id: 'r1', name: 'peanuts', meal_types: ['snack'], allergens: ['peanut'], energy_kcal: 200, protein_g: 8 },
          { id: 'r2', name: 'apple', meal_types: ['snack'], energy_kcal: 80, protein_g: 0 },
          { id: 'r3', name: 'cheese', meal_types: ['snack'], energy_kcal: 110, protein_g: 7 },
        ],
        {
          id: 'm1',
          age: 8,
          sex: 'female' as const,
          allergies: ['peanut'],
          conditions: [],
          diet_pattern: 'omnivore',
          weight_kg: 30,
          height_cm: 130,
          activity: 'moderate' as const,
        },
        []
      );

      // All alternatives should be safe (no peanut)
      proposal.alternatives.forEach((alt) => {
        expect(alt.id).not.toBe('r1');
      });
    });

    it('returns reason if fewer than 3 safe alternatives exist', () => {
      const proposal = proposeSwap(
        {
          id: 'slot-1',
          member_id: 'm1',
          meal_type: 'dinner',
          recipe_id: 'current',
          date: new Date('2026-11-10'),
          locked: false,
          mode: 'individual',
          plan_id: 'plan-1',
        },
        [
          { id: 'r1', name: 'only safe option', meal_types: ['dinner'], energy_kcal: 500, protein_g: 20 },
        ],
        {
          id: 'm1',
          age: 30,
          sex: 'male' as const,
          allergies: [],
          conditions: [],
          diet_pattern: 'omnivore',
          weight_kg: 80,
          height_cm: 180,
          activity: 'moderate' as const,
        },
        []
      );

      expect(proposal.alternatives.length).toBeLessThan(3);
      expect(proposal.reason).toContain('only 1 safe alternative');
    });
  });

  describe('regenerateSlots: rebuild a week/day/meal-type/slot with locked slots preserved', () => {
    it('regenerates all slots except locked ones', () => {
      const result = regenerateSlots(
        'plan-1',
        'week' as RegenerateScope,
        {
          householdId: 'h1',
          members: [
            {
              id: 'm1',
              age: 30,
              sex: 'male' as const,
              allergies: [],
              conditions: [],
              diet_pattern: 'omnivore',
              weight_kg: 80,
              height_cm: 180,
              activity: 'moderate' as const,
            },
          ],
          recipes: [
            { id: 'r1', name: 'option 1', meal_types: ['breakfast', 'lunch', 'snack', 'dinner'], energy_kcal: 300, protein_g: 15 },
          ],
          currentSlots: [
            {
              id: 'slot-1',
              plan_id: 'plan-1',
              date: new Date('2026-11-09'),
              meal_type: 'breakfast' as const,
              member_id: 'm1',
              recipe_id: 'r1',
              mode: 'individual' as const,
              locked: true,
            },
            {
              id: 'slot-2',
              plan_id: 'plan-1',
              date: new Date('2026-11-09'),
              meal_type: 'lunch' as const,
              member_id: 'm1',
              recipe_id: 'r1',
              mode: 'individual' as const,
              locked: false,
            },
          ] as MealSlot[],
          seed: 42,
        }
      );

      expect(result.slots.length).toBeGreaterThanOrEqual(2);
      // Locked slot unchanged
      const lockedResult = result.slots.find((s) => s.id === 'slot-1');
      expect(lockedResult?.recipe_id).toBe('r1');
      expect(lockedResult?.locked).toBe(true);
    });

    it('AC: same inputs, seed, and scope give same regenerated plan (deterministic)', () => {
      const context = {
        householdId: 'h1',
        members: [
          {
            id: 'm1',
            age: 30,
            sex: 'male' as const,
            allergies: [],
            conditions: [],
            diet_pattern: 'omnivore',
            weight_kg: 80,
            height_cm: 180,
            activity: 'moderate' as const,
          },
        ],
        recipes: [
          { id: 'r1', name: 'a', meal_types: ['dinner'], energy_kcal: 500, protein_g: 30 },
          { id: 'r2', name: 'b', meal_types: ['dinner'], energy_kcal: 500, protein_g: 30 },
        ],
        currentSlots: [
          {
            id: 'slot-1',
            plan_id: 'plan-1',
            date: new Date('2026-11-09'),
            meal_type: 'dinner' as const,
            member_id: 'm1',
            recipe_id: 'r1',
            mode: 'individual' as const,
            locked: false,
          },
        ] as MealSlot[],
        seed: 12345,
      };

      const result1 = regenerateSlots('plan-1', 'slot' as RegenerateScope, context);
      const result2 = regenerateSlots('plan-1', 'slot' as RegenerateScope, context);

      expect(result1.slots[0].recipe_id).toBe(result2.slots[0].recipe_id);
    });

    it('regenerates at different scopes: slot, day, meal-type, week', () => {
      const context = {
        householdId: 'h1',
        members: [
          {
            id: 'm1',
            age: 30,
            sex: 'male' as const,
            allergies: [],
            conditions: [],
            diet_pattern: 'omnivore',
            weight_kg: 80,
            height_cm: 180,
            activity: 'moderate' as const,
          },
        ],
        recipes: [
          { id: 'r1', name: 'a', meal_types: ['breakfast', 'lunch', 'snack', 'dinner'], energy_kcal: 400, protein_g: 20 },
        ],
        currentSlots: [
          {
            id: 'slot-1',
            plan_id: 'plan-1',
            date: new Date('2026-11-09'),
            meal_type: 'breakfast' as const,
            member_id: 'm1',
            recipe_id: 'r1',
            mode: 'individual' as const,
            locked: false,
          },
          {
            id: 'slot-2',
            plan_id: 'plan-1',
            date: new Date('2026-11-09'),
            meal_type: 'lunch' as const,
            member_id: 'm1',
            recipe_id: 'r1',
            mode: 'individual' as const,
            locked: false,
          },
        ] as MealSlot[],
        seed: 42,
      };

      const slot = regenerateSlots('plan-1', 'slot', context);
      const day = regenerateSlots('plan-1', 'day', context);
      const mealType = regenerateSlots('plan-1', 'meal_type', context);
      const week = regenerateSlots('plan-1', 'week', context);

      expect(slot.scope).toBe('slot');
      expect(day.scope).toBe('day');
      expect(mealType.scope).toBe('meal_type');
      expect(week.scope).toBe('week');
    });
  });
});

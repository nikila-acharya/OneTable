import { describe, it, expect } from 'vitest';
import { filterCandidates, type HardFilterContext } from './filters';

describe('Hard filters (WP-3.4, SG-A / MP01 constraints)', () => {
  describe('filterCandidates: remove ineligible recipes per member and slot', () => {
    it('excludes recipes with allergenic ingredients (SG-A allergen hard filter)', () => {
      const candidates = [
        { id: 'r1', name: 'peanut butter toast', allergens: ['peanut'] },
        { id: 'r2', name: 'oatmeal', allergens: [] },
        { id: 'r3', name: 'thai noodles', allergens: ['peanut', 'sesame'] },
      ];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 8,
        allergies: ['peanut'],
        conditions: [],
        slot_date: new Date('2026-11-10'),
        meal_type: 'breakfast',
        slot_time_limit_min: 30,
        attending: true,
        is_packed_lunch: false,
      };

      const filtered = filterCandidates(candidates, context);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('r2');
    });

    it('excludes recipes with uncertain ingredients unless confirmed (SG-A)', () => {
      const candidates = [
        { id: 'r1', name: 'risotto', uncertain_ingredients: ['arborio rice (unclear if organic)'] },
        { id: 'r2', name: 'pasta', uncertain_ingredients: [] },
      ];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 30,
        allergies: [],
        conditions: [],
        slot_date: new Date('2026-11-10'),
        meal_type: 'dinner',
        slot_time_limit_min: 30,
        attending: true,
        is_packed_lunch: false,
        uncertain_ingredient_confirmations: [], // Not confirmed
      };

      const filtered = filterCandidates(candidates, context);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('r2');
    });

    it('allows recipes with uncertain ingredients if member confirmed them', () => {
      const candidates = [
        { id: 'r1', name: 'risotto', uncertain_ingredients: ['arborio rice (unclear if organic)'] },
      ];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 30,
        allergies: [],
        conditions: [],
        slot_date: new Date('2026-11-10'),
        meal_type: 'dinner',
        slot_time_limit_min: 30,
        attending: true,
        is_packed_lunch: false,
        uncertain_ingredient_confirmations: ['arborio rice (unclear if organic)'],
      };

      const filtered = filterCandidates(candidates, context);
      expect(filtered).toHaveLength(1);
    });

    it('excludes recipes that exceed slot time limit (MP01 constraint)', () => {
      const candidates = [
        { id: 'r1', name: 'quick pasta', prep_time_min: 15 },
        { id: 'r2', name: 'slow-roasted brisket', prep_time_min: 180 },
      ];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 30,
        allergies: [],
        conditions: [],
        slot_date: new Date('2026-11-10'),
        meal_type: 'dinner',
        slot_time_limit_min: 30,
        attending: true,
        is_packed_lunch: false,
      };

      const filtered = filterCandidates(candidates, context);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('r1');
    });

    it('excludes members not attending a slot', () => {
      const candidates = [{ id: 'r1', name: 'breakfast', allergens: [] }];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 30,
        allergies: [],
        conditions: [],
        slot_date: new Date('2026-11-10'),
        meal_type: 'breakfast',
        slot_time_limit_min: 30,
        attending: false, // Not attending
        is_packed_lunch: false,
      };

      const filtered = filterCandidates(candidates, context);
      // No recipes eligible for non-attending members
      expect(filtered).toHaveLength(0);
    });

    it('requires recipes suitable for packed lunch when needed', () => {
      const candidates = [
        { id: 'r1', name: 'hot soup', packable: false },
        { id: 'r2', name: 'sandwich', packable: true },
      ];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 10,
        allergies: [],
        conditions: [],
        slot_date: new Date('2026-11-12'), // Tuesday
        meal_type: 'lunch',
        slot_time_limit_min: 60,
        attending: true,
        is_packed_lunch: true, // At school
      };

      const filtered = filterCandidates(candidates, context);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('r2');
    });

    it('excludes recipes excluded by dietary pattern (diet, cultural, ethical)', () => {
      const candidates = [
        { id: 'r1', name: 'beef stew', diet_patterns: ['omnivore'] },
        { id: 'r2', name: 'tofu stir-fry', diet_patterns: ['vegetarian', 'vegan'] },
      ];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 30,
        allergies: [],
        conditions: [],
        diet_pattern: 'vegetarian', // Member is vegetarian
        slot_date: new Date('2026-11-10'),
        meal_type: 'dinner',
        slot_time_limit_min: 45,
        attending: true,
        is_packed_lunch: false,
      };

      const filtered = filterCandidates(candidates, context);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('r2');
    });

    it('AC: swap alternatives never violate a member\'s allergen or condition gate', () => {
      // Property-based test will live in WP-3.7; this is a smoke test
      const candidates = [
        { id: 'r1', name: 'peanut butter', allergens: ['peanut'] },
        { id: 'r2', name: 'tree nut mix', allergens: ['tree_nuts'] },
      ];

      const context: HardFilterContext = {
        member_id: 'm1',
        age: 10,
        allergies: ['peanut', 'tree_nuts'],
        conditions: [],
        slot_date: new Date('2026-11-10'),
        meal_type: 'snack',
        slot_time_limit_min: 15,
        attending: true,
        is_packed_lunch: false,
      };

      const filtered = filterCandidates(candidates, context);
      // Both have allergens the member cannot have
      expect(filtered).toHaveLength(0);
    });
  });
});

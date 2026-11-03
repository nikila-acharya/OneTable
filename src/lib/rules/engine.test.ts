import { describe, it, expect } from 'vitest';
import { loadRuleSet, checkAgainstRules, type Rule, type RuleEvaluation } from './engine';

describe('Rule engine (WP-3.1, TR-RULES)', () => {
  describe('loadRuleSet', () => {
    it('parses a valid YAML rule file and returns a versioned rule set', () => {
      const yaml = `id: SG02-no-deficit-under-18
description: No calorie deficit or weight-loss target for members under 18
applies_to: { age_lt: 18 }
type: hard
check: target.energy_kcal >= eer_maintenance(member)
source:
  name: American Academy of Pediatrics, Clinical Practice Guideline for Obesity (2023)
  url: https://example.com/aap-obesity-2023
confidence: Likely
reviewed_by: null
reviewed_on: null`;

      const rules = loadRuleSet(yaml);
      expect(rules).toHaveLength(1);
      expect(rules[0]).toMatchObject({
        id: 'SG02-no-deficit-under-18',
        description: 'No calorie deficit or weight-loss target for members under 18',
        type: 'hard',
        source: expect.objectContaining({
          name: expect.stringContaining('American Academy of Pediatrics'),
          url: expect.stringContaining('https://'),
        }),
      });
    });

    it('requires all rules to have source.name and source.url', () => {
      const invalidYaml = `id: SG01
type: hard
source:
  name: Missing URL
  url: null`;

      expect(() => {
        loadRuleSet(invalidYaml);
      }).toThrow(/source\.url/i);
    });

    it('rejects rules missing source.name', () => {
      const invalidYaml = `id: SG01
type: hard
source:
  name: null
  url: https://example.com`;

      expect(() => {
        loadRuleSet(invalidYaml);
      }).toThrow(/source\.name/i);
    });

    it('infers a version string from the rule set modification time', () => {
      const yaml = `id: SG01
type: hard
source:
  name: Test Rule
  url: https://example.com`;

      const rules = loadRuleSet(yaml);
      expect(rules).toHaveLength(1);
      // Version is added by the engine; just verify it's a string
      expect(typeof rules[0].version).toBe('string');
    });
  });

  describe('checkAgainstRules', () => {
    it('returns an empty result when no rules apply to a target', () => {
      const rules: Rule[] = [
        {
          id: 'SG02-under-18',
          type: 'hard',
          applies_to: { age_lt: 18 },
          source: { name: 'Test', url: 'https://example.com' },
          confidence: 'Likely',
          reviewed_by: null,
          check: 'mock-check',
          version: 'v1',
        },
      ];

      // Adult member, so SG02 does not apply
      const evaluation = checkAgainstRules(rules, {
        age: 30,
        allergies: [],
        conditions: [],
      });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.appliedRules).toHaveLength(0);
    });

    it('marks a check as failed if a hard rule is violated', () => {
      const rules: Rule[] = [
        {
          id: 'SG02-under-18',
          type: 'hard',
          applies_to: { age_lt: 18 },
          source: { name: 'Test', url: 'https://example.com' },
          confidence: 'Likely',
          reviewed_by: null,
          check: 'energy_kcal >= 1200',
          version: 'v1',
        },
      ];

      // Child member with energy target below the floor (mock check)
      const evaluation = checkAgainstRules(rules, {
        age: 12,
        target: { energy_kcal: 900 }, // Below floor
        allergies: [],
        conditions: [],
      });

      expect(evaluation.passed).toBe(false);
      expect(evaluation.failedRules).toContainEqual(
        expect.objectContaining({ id: 'SG02-under-18', type: 'hard' })
      );
    });

    it('applies soft rules as score penalties', () => {
      const rules: Rule[] = [
        {
          id: 'SOFT-variety',
          type: 'soft',
          applies_to: {},
          source: { name: 'Test', url: 'https://example.com' },
          confidence: 'Guessing',
          reviewed_by: null,
          check: 'recipe_diversity_score > 0.5',
          version: 'v1',
        },
      ];

      const evaluation = checkAgainstRules(rules, {
        age: 30,
        allergies: [],
        conditions: [],
        recipe_diversity_score: 0.3, // Below threshold
      });

      expect(evaluation.passed).toBe(true);
      expect(evaluation.appliedRules).toContainEqual(
        expect.objectContaining({ id: 'SOFT-variety', type: 'soft' })
      );
    });

    it('detects allergen hard filters', () => {
      const rules: Rule[] = [
        {
          id: 'SG-A-allergens',
          type: 'hard',
          applies_to: {},
          source: { name: 'Allergen filter', url: 'https://example.com' },
          confidence: 'Certain',
          reviewed_by: null,
          check: 'peanut not in member_allergies',
          version: 'v1',
        },
      ];

      // Member with peanut allergy
      const evaluation = checkAgainstRules(rules, {
        age: 30,
        allergies: ['peanut'],
        conditions: [],
      });

      expect(evaluation.appliedRules).toContainEqual(
        expect.objectContaining({ id: 'SG-A-allergens' })
      );
    });
  });

  describe('rule-set versioning (deterministic planner)', () => {
    it('includes version in the rule set so the planner can record which rules were checked', () => {
      const yaml = `id: SG01
type: hard
source:
  name: Test
  url: https://example.com`;

      const rules = loadRuleSet(yaml);
      expect(rules[0].version).toBeDefined();
      expect(typeof rules[0].version).toBe('string');
      expect(rules[0].version.length).toBeGreaterThan(0);
    });

    it('uses the same version for all rules loaded from the same file', () => {
      const yaml = `id: SG01
type: hard
source:
  name: Test 1
  url: https://example.com
---
id: SG02
type: hard
source:
  name: Test 2
  url: https://example.com`;

      const rules = loadRuleSet(yaml);
      expect(rules).toHaveLength(2);
      expect(rules[0].version).toBe(rules[1].version);
    });
  });

  describe('AC: every code path writes a plan row with a rule-engine pass record (plan_rule_check)', () => {
    it('requires a plan_rule_check entry before a plan can be marked accepted', () => {
      // This AC is enforced at the planner layer (M3.5), not here.
      // Here we just verify the engine produces the evidence.
      const rules: Rule[] = [
        {
          id: 'SG01',
          type: 'hard',
          applies_to: {},
          source: { name: 'Test', url: 'https://example.com' },
          confidence: 'Likely',
          reviewed_by: null,
          check: 'true',
          version: 'rule-set-v1.0',
        },
      ];

      const evaluation = checkAgainstRules(rules, {
        age: 30,
        allergies: [],
        conditions: [],
      });

      expect(evaluation).toHaveProperty('ruleSetVersion');
      expect(evaluation.ruleSetVersion).toBe('rule-set-v1.0');
    });
  });
});

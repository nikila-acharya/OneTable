/**
 * WP-1.4 — SG01 condition gate tests (PRD 5.2 SG01, 6.3 SG-C/SG-G/SG-H).
 * Sections 6/7 code gets tests first (PRD 13.1).
 */
import { describe, expect, it } from 'vitest';

import {
  assertNoMemberNutrientTarget,
  ConditionGateViolation,
  evaluateConditionGate,
  gatedMembers,
  withoutMemberTargets,
} from '../lib/conditions/gate.js';
import { CLINICIAN_BANNER_COPY } from '../lib/conditions/copy.js';
import { CONDITION_POLICIES } from '../lib/conditions/policy.js';
import { CONDITION_SLUGS } from '../lib/conditions/enum.js';

describe('evaluateConditionGate — SG01 general-guidance mode', () => {
  it('PRD 5.2 SG01 AC: a CKD member gets general-guidance mode and the clinician banner', () => {
    const gate = evaluateConditionGate('m-ckd', ['chronic_kidney_disease']);
    expect(gate.mode).toBe('general_guidance');
    expect(gate.showClinicianBanner).toBe(true);
    expect(gate.triggers).toEqual(['chronic_kidney_disease']);
    expect(gate.bannerCopy).toBe('General guidance only. Confirm with your clinician.');
    expect(gate.glutenHardFilter).toBe(false);
  });

  it('banner copy is the exact PRD string from the single source of truth', () => {
    // PRD 5.2 SG01 verbatim. If either changes, this test fails on purpose.
    expect(CLINICIAN_BANNER_COPY).toBe('General guidance only. Confirm with your clinician.');
    expect(evaluateConditionGate('m1', ['pregnancy']).bannerCopy).toBe(CLINICIAN_BANNER_COPY);
  });

  it.each([
    'type_1_diabetes',
    'type_2_diabetes',
    'chronic_kidney_disease',
    'heart_failure',
    'pregnancy',
    'eating_disorder_history',
    'food_drug_interactions',
  ] as const)('SG01 bullet 1 names %s → gated', (slug) => {
    expect(evaluateConditionGate('m', [slug]).mode).toBe('general_guidance');
  });

  it('fail-safe superset: the other listed conditions are gated too (see ADR 114, pending owner/RD call)', () => {
    for (const slug of ['prediabetes', 'hypertension', 'high_cholesterol', 'celiac_disease', 'breastfeeding'] as const) {
      expect(CONDITION_POLICIES[slug].generalGuidance).toBe(true);
      expect(evaluateConditionGate('m', [slug]).mode).toBe('general_guidance');
    }
  });

  it('"other" is recognized but not acted on (PR03)', () => {
    const gate = evaluateConditionGate('m', ['other']);
    expect(gate.mode).toBe('normal');
    expect(gate.showClinicianBanner).toBe(false);
    expect(gate.bannerCopy).toBe('');
    expect(gate.triggers).toEqual([]);
    expect(gate.unrecognized).toEqual([]);
  });

  it('a member with no conditions is in normal mode', () => {
    expect(evaluateConditionGate('m', []).mode).toBe('normal');
    expect(evaluateConditionGate('m', null).mode).toBe('normal');
    expect(evaluateConditionGate('m', undefined).mode).toBe('normal');
  });

  it('unrecognized condition strings FAIL SAFE into general-guidance mode', () => {
    const gate = evaluateConditionGate('m', ['lupus', 'type_2_diabetes']);
    expect(gate.mode).toBe('general_guidance');
    expect(gate.unrecognized).toEqual(['lupus']);
    expect(gate.triggers).toEqual(['type_2_diabetes']);
  });

  it('triggers are deterministic regardless of input order (policy-table order)', () => {
    const a = evaluateConditionGate('m', ['hypertension', 'type_1_diabetes', 'celiac_disease']);
    const b = evaluateConditionGate('m', ['celiac_disease', 'hypertension', 'type_1_diabetes']);
    expect(a.triggers).toEqual(b.triggers);
    expect(a.triggers).toEqual(['type_1_diabetes', 'hypertension', 'celiac_disease']);
  });

  it('recognizes WP-1.3 stored slugs end-to-end (food_drug_interactions interop, ADR 114)', () => {
    const gate = evaluateConditionGate('m', ['food_drug_interactions']);
    expect(gate.unrecognized).toEqual([]);
    expect(gate.mode).toBe('general_guidance');
  });

  it('every PR03 enum slug has exactly one policy row', () => {
    expect(Object.keys(CONDITION_POLICIES).sort()).toEqual([...CONDITION_SLUGS].sort());
  });
});

describe('celiac → hard gluten filter (SG01 bullet 3)', () => {
  it('celiac sets glutenHardFilter, like an allergen', () => {
    const gate = evaluateConditionGate('m', ['celiac_disease']);
    expect(gate.glutenHardFilter).toBe(true);
  });

  it('no other condition sets it', () => {
    for (const slug of CONDITION_SLUGS) {
      if (slug === 'celiac_disease') continue;
      expect(evaluateConditionGate('m', [slug]).glutenHardFilter).toBe(false);
    }
  });

  it('celiac plus other conditions still filters gluten', () => {
    expect(evaluateConditionGate('m', ['celiac_disease', 'hypertension']).glutenHardFilter).toBe(true);
  });
});

describe('DGA awareness flags (SG01 bullet 3, Proposed — RD review at Gate B)', () => {
  it('hypertension → sodium awareness, display-only', () => {
    expect(evaluateConditionGate('m', ['hypertension']).dgaAwareness).toEqual(['sodium']);
  });

  it('high cholesterol → saturated fat awareness', () => {
    expect(evaluateConditionGate('m', ['high_cholesterol']).dgaAwareness).toEqual(['saturated_fat']);
  });

  it('the two union and dedupe', () => {
    expect(evaluateConditionGate('m', ['hypertension', 'high_cholesterol', 'hypertension']).dgaAwareness)
      .toEqual(['saturated_fat', 'sodium']);
  });

  it('no other condition adds awareness', () => {
    expect(evaluateConditionGate('m', ['prediabetes']).dgaAwareness).toEqual([]);
  });
});

describe('no member-specific nutrient targets for gated members (SG01 AC, SG-H)', () => {
  const gated = evaluateConditionGate('m-ckd', ['chronic_kidney_disease']);
  const open = evaluateConditionGate('m-ok', []);

  it('assertNoMemberNutrientTarget throws for a gated member with a target', () => {
    expect(() => assertNoMemberNutrientTarget(gated, { key: 'energy_kcal' })).toThrow(ConditionGateViolation);
    expect(() => assertNoMemberNutrientTarget(gated, { key: 'sodium_mg' })).toThrow(/general-guidance mode/);
  });

  it('assertNoMemberNutrientTarget passes when there is no target or the member is open', () => {
    expect(() => assertNoMemberNutrientTarget(gated, null)).not.toThrow();
    expect(() => assertNoMemberNutrientTarget(gated, undefined)).not.toThrow();
    expect(() => assertNoMemberNutrientTarget(open, { key: 'energy_kcal' })).not.toThrow();
  });

  it('withoutMemberTargets strips flags-only output for read paths', () => {
    expect(withoutMemberTargets(gated, { energy_kcal: 2000 })).toBeNull();
    expect(withoutMemberTargets(open, { energy_kcal: 2000 })).toEqual({ energy_kcal: 2000 });
  });

  it('gatedMembers selects just the gated subset', () => {
    const gates = [gated, open, evaluateConditionGate('m-p', ['pregnancy'])];
    expect(gatedMembers(gates).map((g) => g.memberId)).toEqual(['m-ckd', 'm-p']);
  });
});

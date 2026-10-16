/**
 * WP-1.4 — enum contract tests. The pinned list below is THE interop contract
 * with WP-1.3's `lib/health/enums.ts` CONDITION_IDS (the values the health API
 * stores), derived from PRD 5.2 PR03/SG01 wording (ADR 114 D1: one canonical
 * slug table, spelling from the PRD, post-merge re-export whichever side lands
 * first). If either side renames a slug without updating the other, this fails
 * in CI.
 */
import { describe, expect, it } from 'vitest';

import {
  CONDITION_LABELS,
  CONDITION_PHRASE_MAP,
  CONDITION_SLUGS,
  isConditionSlug,
} from '../lib/conditions/enum.js';

const WP13_CANONICAL = [
  'type_1_diabetes',
  'type_2_diabetes',
  'prediabetes',
  'hypertension',
  'chronic_kidney_disease',
  'heart_failure',
  'high_cholesterol',
  'celiac_disease',
  'pregnancy',
  'breastfeeding',
  'eating_disorder_history',
  'food_drug_interactions',
  'other',
];

describe('PR03 condition enum — WP-1.3 interop contract', () => {
  it('slug set is identical to WP-1.3 stored values (no drift)', () => {
    expect([...CONDITION_SLUGS]).toEqual(WP13_CANONICAL);
  });

  it('every slug has a display label', () => {
    expect(Object.keys(CONDITION_LABELS).sort()).toEqual([...CONDITION_SLUGS].sort());
  });

  it('isConditionSlug accepts exactly the enum', () => {
    expect(isConditionSlug('celiac_disease')).toBe(true);
    expect(isConditionSlug('lupus')).toBe(false);
    expect(isConditionSlug('')).toBe(false);
    expect(isConditionSlug(null)).toBe(false);
    expect(isConditionSlug(7)).toBe(false);
  });

  it('the phrase map only points at valid slugs (agent mapping safety)', () => {
    for (const slug of Object.values(CONDITION_PHRASE_MAP)) {
      expect(isConditionSlug(slug)).toBe(true);
    }
    expect(CONDITION_PHRASE_MAP['celiac']).toBe('celiac_disease');
    expect(CONDITION_PHRASE_MAP['warfarin']).toBe('food_drug_interactions');
    expect(CONDITION_PHRASE_MAP['kidney disease']).toBe('chronic_kidney_disease');
  });

  it('no free-text condition is ever representable (PR03)', () => {
    for (const bad of ['diabeetus', 'IBS', 'gluten sensitivity', 'PCOS', 'hypoglycemia']) {
      expect(isConditionSlug(bad)).toBe(false);
    }
  });
});

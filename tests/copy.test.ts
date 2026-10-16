/**
 * WP-1.4 — fixed copy + banned-term lint seed (PRD 6.4, 7.3 checks 1–2,
 * 16.5 tone rules).
 */
import { describe, expect, it } from 'vitest';

import {
  BANNED_COPY_TERMS,
  CLINICIAN_BANNER_COPY,
  CLINICIAN_CONFIRM_MESSAGE,
  findBannedTerms,
  under18AdviceViolations,
} from '../lib/conditions/copy.js';

describe('clinician copy — single source of truth', () => {
  it('banner copy matches PRD 5.2 SG01 verbatim', () => {
    expect(CLINICIAN_BANNER_COPY).toBe('General guidance only. Confirm with your clinician.');
  });

  it('the clinician-confirm reply reuses the same string (SG01 bullet 3)', () => {
    expect(CLINICIAN_CONFIRM_MESSAGE).toBe(CLINICIAN_BANNER_COPY);
  });

  it('the fixed copy itself passes the banned-copy lint', () => {
    expect(findBannedTerms(CLINICIAN_BANNER_COPY)).toEqual([]);
  });
});

describe('banned-copy check (6.4)', () => {
  it('catches the PRD-named examples', () => {
    expect(findBannedTerms('This helps manage your diabetes over time.')).toContain('manage your diabetes');
    expect(findBannedTerms('A diet that can treat the condition')).toContain('treat');
    expect(findBannedTerms('A cure for high cholesterol')).toContain('cure');
  });

  it('is case-insensitive', () => {
    expect(findBannedTerms('Manage Your DIABETES with this plan')).toContain('manage your diabetes');
  });

  it('catches diet-culture terms from the 7.3 list', () => {
    expect(findBannedTerms('Guilt-free treats for the kids')).toContain('guilt-free');
    expect(findBannedTerms('Save the cheat meal for Friday')).toContain('cheat meal');
    expect(findBannedTerms('You can burn off those calories at the gym')).toContain('burn off');
  });

  it('passes normal healthy-eating copy', () => {
    const clean = 'Tuesday dinner is salmon, rice and broccoli — the kids helped pick the veggies.';
    expect(findBannedTerms(clean)).toEqual([]);
  });

  it('the list stays small enough to avoid lint spam (guard: nothing beyond 6.4/7.3 territory)', () => {
    expect(BANNED_COPY_TERMS.length).toBeLessThanOrEqual(25);
  });
});

describe('under-18 check (7.3 check 2)', () => {
  const kids = ['Ava', 'Ben'];

  it('blocks weight-loss language in sentences referring to an under-18 member', () => {
    const text = 'Ava loved the pasta. For dinner we can put Ava on a calorie deficit plan.';
    expect(under18AdviceViolations(text, kids)).toHaveLength(1);
  });

  it('is name-case-insensitive and sentence-scoped', () => {
    expect(under18AdviceViolations('Great idea! ben does not need weight loss tips.', kids)).toHaveLength(1);
    expect(under18AdviceViolations('Weight loss is not part of any plan for you. Ava is happy with veggies.', kids)).toHaveLength(0);
  });

  it('no violations when there are no under-18 members', () => {
    expect(under18AdviceViolations('Ava starts a serious calorie cut this week.', [])).toHaveLength(0);
  });
});

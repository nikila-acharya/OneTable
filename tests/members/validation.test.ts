// PR01 field rules + required-fields-first.
import { describe, expect, it } from 'vitest';
import { deriveAgeYears, isUnder13, isUnder18, isValidBirthYm, parseBirthYm } from '../../lib/members/age';
import { validateMemberInput } from '../../lib/members/validation';
import { ADULT } from '../helpers';

const NOW = new Date('2026-10-16T12:00:00Z');
const ctx = { now: NOW, existing: null, existingPrefs: null };

describe('age derivation (PR01: age is derived)', () => {
  it('parses only strict YYYY-MM', () => {
    expect(parseBirthYm('1988-04')).toEqual({ year: 1988, month: 4 });
    expect(parseBirthYm('1988-4')).toBeNull();
    expect(parseBirthYm('1988-13')).toBeNull();
    expect(parseBirthYm('88-04')).toBeNull();
    expect(isValidBirthYm('1988-04')).toBe(true);
  });

  it('computes whole years with month boundaries', () => {
    expect(deriveAgeYears('2013-10', NOW)).toBe(13); // birthday month = current month
    expect(deriveAgeYears('2013-11', NOW)).toBe(12); // still 12 until November
    expect(deriveAgeYears('1988-04', NOW)).toBe(38);
  });

  it('drives the PV02 boundaries', () => {
    expect(isUnder13('2013-11', NOW)).toBe(true); // 12
    expect(isUnder13('2013-10', NOW)).toBe(false); // exactly 13
    expect(isUnder18('2008-10', NOW)).toBe(false); // exactly 18
    expect(isUnder18('2008-11', NOW)).toBe(true); // 17
  });
});

describe('validateMemberInput — PR01', () => {
  it('accepts a member with ONLY the required fields (AC: one screen)', () => {
    const r = validateMemberInput({ ...ADULT }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.name).toBe('Priya');
      expect(r.normalized.dietPattern).toBeNull();
      expect(r.normalized.healthKeysTouched).toEqual([]);
    }
  });

  it('lists missing required fields before optional-field issues (required-fields-first)', () => {
    const r = validateMemberInput({ heightCm: 999 }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const fields = r.issues.map((i) => i.field);
      expect(fields).toEqual(['name', 'birthYm', 'sex', 'activityLevel', 'heightCm']);
      expect(r.issues.slice(0, 4).every((i) => i.code === 'required')).toBe(true);
    }
  });

  it('caps the display name at 40 chars', () => {
    const ok = validateMemberInput({ ...ADULT, name: 'x'.repeat(40) }, ctx);
    const bad = validateMemberInput({ ...ADULT, name: 'x'.repeat(41) }, ctx);
    expect(ok.ok).toBe(true);
    expect(bad.ok).toBe(false);
  });

  it('rejects malformed, future and implausible birthYm', () => {
    expect(validateMemberInput({ ...ADULT, birthYm: '1988/04' }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, birthYm: '2030-01' }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, birthYm: '1901-01' }, ctx).ok).toBe(false); // >120 years
  });

  it('enforces fixed enums for sex, activityLevel, dietPattern', () => {
    expect(validateMemberInput({ ...ADULT, sex: 'other' }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, activityLevel: 'marathoner' }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, dietPattern: 'keto' }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, dietPattern: 'vegetarian' }, ctx).ok).toBe(true);
    expect(validateMemberInput({ ...ADULT, sex: 'prefer_not_to_say' }, ctx).ok).toBe(true);
  });

  it('range-checks measurements but weight is never required', () => {
    expect(validateMemberInput({ ...ADULT, heightCm: 170 }, ctx).ok).toBe(true);
    expect(validateMemberInput({ ...ADULT, heightCm: 300 }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, weightKg: 70 }, ctx).ok).toBe(true);
    expect(validateMemberInput({ ...ADULT, weightKg: -5 }, ctx).ok).toBe(false);
    // weight absent entirely is fine (optional, never required):
    const r = validateMemberInput({ ...ADULT }, ctx);
    expect(r.ok && !('weightKg' in r.normalized.health)).toBe(true);
  });

  it('bounds preference tags', () => {
    expect(validateMemberInput({ ...ADULT, likes: ['mushrooms', ' paneer '], dislikes: [] }, ctx).ok).toBe(true);
    if (true) {
      const r = validateMemberInput({ ...ADULT, likes: ['mushrooms', ' paneer '] }, ctx);
      expect(r.ok && r.normalized.likes).toEqual(['mushrooms', 'paneer']);
    }
    expect(validateMemberInput({ ...ADULT, likes: ['x'.repeat(41)] }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, likes: [''] }, ctx).ok).toBe(false);
    expect(validateMemberInput({ ...ADULT, likes: Array.from({ length: 51 }, (_, i) => `t${i}`) }, ctx).ok).toBe(false);
  });

  it('update semantics: omitted fields satisfy "required" from the stored profile', () => {
    const existing = {
      id: 'm1',
      householdId: 'hh',
      name: 'Ravi',
      birthYm: '2015-06',
      sex: 'male',
      activityLevel: 'active',
      dietPattern: null,
      createdAt: '',
      updatedAt: '',
    } as const;
    const r = validateMemberInput({ id: 'm1', dietPattern: 'vegetarian' }, { now: NOW, existing, existingPrefs: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.normalized.name).toBe('Ravi');
      expect(r.normalized.profileKeysTouched).toEqual(['dietPattern']);
    }
  });
});

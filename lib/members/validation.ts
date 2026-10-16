// WP-1.2 validation: PR01 required-fields-first, PV02 child constraints, enums.
// Hand-rolled (no schema library) so the tool layer stays dependency-free.
// Update semantics: fields omitted from the payload keep their stored values
// ("required" is satisfied by what is already on the member); explicit null on an
// optional field clears it. On create there is nothing to fall back to, so the PR01
// required set — name, birthYm, sex, activityLevel — must all be present.

import {
  ACTIVITY_LEVELS,
  DIET_PATTERNS,
  MEAL_TYPES,
  NAME_MAX_LEN,
  PREF_MAX_COUNT,
  PREF_TAG_MAX_LEN,
  SEXES,
  WEEKDAY_MAX,
  WEEKDAY_MIN,
  type ActivityLevel,
  type AttendanceEntry,
  type DietPattern,
  type HealthPatch,
  type MemberPrefs,
  type MemberRecord,
  type Sex,
} from './types';
import { deriveAgeYears, isFutureBirthYm, isImprobablyOld, isValidBirthYm } from './age';

export interface ValidationIssue {
  /** Field path, e.g. "name" or "entries[2].weekday". */
  field: string;
  code:
    | 'required'
    | 'invalid_type'
    | 'invalid_format'
    | 'out_of_range'
    | 'not_allowed'
    | 'auth_fields_forbidden'
    | 'child_collection_limit';
  message: string;
}

// PR01 required-fields-first: issues and UI metadata list required fields before
// optional ones, in this order (matches the member-sheet layout rule, PRD 16.5).
export const FIELD_ORDER: string[] = [
  'name',
  'birthYm',
  'sex',
  'activityLevel',
  'dietPattern',
  'heightCm',
  'weightKg',
  'allergies',
  'otherAllergens',
  'conditions',
  'likes',
  'dislikes',
];

export const REQUIRED_FIELDS: string[] = ['name', 'birthYm', 'sex', 'activityLevel'];

const PROFILE_KEYS = ['name', 'birthYm', 'sex', 'activityLevel', 'dietPattern'] as const;
const HEALTH_KEYS: Array<keyof HealthPatch> = ['heightCm', 'weightKg', 'allergies', 'otherAllergens', 'conditions'];

/** PV02 AC: the data model has no auth fields on member. Any credential-ish or
 * identity/contact key in an agent or API payload is rejected, for members of every age. */
const AUTH_FIELD_NAMES = new Set(
  [
    'email',
    'phone',
    'mobile',
    'password',
    'passcode',
    'pin',
    'otp',
    'username',
    'login',
    'auth',
    'authprovider',
    'auth_provider',
    'authentication',
    'credentials',
    'session',
    'cookie',
    'deviceid',
    'ipaddress',
    'geolocation',
    'socialsecuritynumber',
    'ssn',
    'driverslicense',
  ],
);

/** PV02 under-13 collection limits [Proposed, COPPA-minded]. A child under 13 carries
 * only what planning needs: name, age, sex, activity level, diet pattern, allergies
 * (PR02), conditions (SG01 gate), likes/dislikes, and optional height. Body-weight
 * numbers are the field the PRD fences off, so the data layer refuses them outright.
 * The interpretation (sex/activity/diet/conditions kept because the planner consumes
 * them and they are not identity or contact data) is recorded for owner and Safety &
 * QA sign-off in docs/wp-1.2-notes.md. */
const UNDER13_BLOCKED_KEYS = new Set<string>(['weightKg']);

export interface NormalizedMemberInput {
  id: string | null;
  name: string;
  birthYm: string;
  sex: Sex;
  activityLevel: ActivityLevel;
  dietPattern: DietPattern | null;
  likes: string[];
  dislikes: string[];
  health: HealthPatch;
  /** Profile keys present in this payload (patch semantics on update). */
  profileKeysTouched: string[];
  /** True when likes/dislikes were present — otherwise stored prefs stay untouched. */
  prefsTouched: boolean;
  /** Health keys present in this payload — drives consent checks and the store patch. */
  healthKeysTouched: Array<keyof HealthPatch>;
}

export interface MemberValidationContext {
  now: Date;
  /** The stored member when this payload updates an existing profile, else null. */
  existing: MemberRecord | null;
  existingPrefs: MemberPrefs | null;
}

export type MemberValidationResult =
  | { ok: true; normalized: NormalizedMemberInput; ageYears: number }
  | { ok: false; issues: ValidationIssue[] };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function ordered(issues: ValidationIssue[]): ValidationIssue[] {
  const rank = (f: string): number => {
    const head = f.split(/[.[]/)[0] ?? f;
    const i = FIELD_ORDER.indexOf(head);
    return i === -1 ? FIELD_ORDER.length : i;
  };
  return [...issues].sort((a, b) => rank(a.field) - rank(b.field) || a.field.localeCompare(b.field));
}

function strArrayIssues(input: Record<string, unknown>, field: string): ValidationIssue[] {
  const v = input[field];
  const issues: ValidationIssue[] = [];
  if (v === undefined) return issues;
  if (!Array.isArray(v)) {
    return [{ field, code: 'invalid_type', message: `${field} must be an array of strings` }];
  }
  if (v.length > PREF_MAX_COUNT) {
    issues.push({ field, code: 'out_of_range', message: `${field}: at most ${PREF_MAX_COUNT} tags` });
  }
  v.forEach((item, i) => {
    if (typeof item !== 'string' || item.trim() === '') {
      issues.push({ field: `${field}[${i}]`, code: 'invalid_type', message: `${field}[${i}] must be a non-empty string` });
    } else if (item.trim().length > PREF_TAG_MAX_LEN) {
      issues.push({ field: `${field}[${i}]`, code: 'out_of_range', message: `${field}[${i}] exceeds ${PREF_TAG_MAX_LEN} chars` });
    }
  });
  return issues;
}

export function validateMemberInput(
  raw: unknown,
  ctx: MemberValidationContext,
): MemberValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ field: '', code: 'invalid_type', message: 'input must be an object' }] };
  }
  const input = raw;
  const issues: ValidationIssue[] = [];
  const ex = ctx.existing;
  const updating = ex !== null;

  // 1. Auth / identity fields rejected outright (PV02 AC).
  for (const key of Object.keys(input)) {
    if (AUTH_FIELD_NAMES.has(key.toLowerCase())) {
      issues.push({
        field: key,
        code: 'auth_fields_forbidden',
        message:
          'members are profiles only — no credentials, contact or identity fields (PV02). Only the account holder (user) can authenticate.',
      });
    }
  }

  const valueOf = (k: string): unknown => (k in input ? input[k] : undefined);
  const eff = (k: string, fallback: unknown): unknown => {
    const v = valueOf(k);
    return v === undefined ? fallback : v;
  };

  // 2. Required fields (PR01). On update, the stored value satisfies them.
  const name = eff('name', ex?.name);
  if (name === undefined || name === null || (typeof name === 'string' && name.trim() === '')) {
    issues.push({ field: 'name', code: 'required', message: 'display name is required' });
  } else if (typeof name !== 'string') {
    issues.push({ field: 'name', code: 'invalid_type', message: 'name must be a string' });
  } else if (name.trim().length > NAME_MAX_LEN) {
    issues.push({ field: 'name', code: 'out_of_range', message: `display name must be at most ${NAME_MAX_LEN} characters` });
  }

  const birthYm = eff('birthYm', ex?.birthYm);
  if (birthYm === undefined || birthYm === null || birthYm === '') {
    issues.push({ field: 'birthYm', code: 'required', message: 'birth year and month are required (YYYY-MM) — age is derived from them' });
  } else if (typeof birthYm !== 'string' || !isValidBirthYm(birthYm)) {
    issues.push({ field: 'birthYm', code: 'invalid_format', message: 'birthYm must be "YYYY-MM"' });
  } else if (isFutureBirthYm(birthYm, ctx.now)) {
    issues.push({ field: 'birthYm', code: 'invalid_format', message: 'birthYm cannot be in the future' });
  } else if (isImprobablyOld(birthYm, ctx.now)) {
    issues.push({ field: 'birthYm', code: 'out_of_range', message: 'birthYm implies an age over 120 — check the year' });
  }

  const sex = eff('sex', ex?.sex);
  if (sex === undefined || sex === null || sex === '') {
    issues.push({ field: 'sex', code: 'required', message: 'sex is required (female, male, or prefer_not_to_say)' });
  } else if (!SEXES.includes(sex as Sex)) {
    issues.push({ field: 'sex', code: 'not_allowed', message: `sex must be one of: ${SEXES.join(', ')}` });
  }

  const activityLevel = eff('activityLevel', ex?.activityLevel);
  if (activityLevel === undefined || activityLevel === null || activityLevel === '') {
    issues.push({ field: 'activityLevel', code: 'required', message: 'activity level is required (sedentary, low_active, active, very_active)' });
  } else if (!ACTIVITY_LEVELS.includes(activityLevel as ActivityLevel)) {
    issues.push({ field: 'activityLevel', code: 'not_allowed', message: `activityLevel must be one of: ${ACTIVITY_LEVELS.join(', ')}` });
  }

  // 3. Optional fields.
  const dietPattern = valueOf('dietPattern');
  if (dietPattern !== undefined && dietPattern !== null && !DIET_PATTERNS.includes(dietPattern as DietPattern)) {
    issues.push({ field: 'dietPattern', code: 'not_allowed', message: `dietPattern must be one of: ${DIET_PATTERNS.join(', ')}` });
  }

  const height = valueOf('heightCm');
  if (height !== undefined && height !== null) {
    if (typeof height !== 'number' || !Number.isFinite(height) || height < 30 || height > 250) {
      issues.push({ field: 'heightCm', code: 'out_of_range', message: 'heightCm must be a number between 30 and 250' });
    }
  }

  // Weight: optional, never required (PR01); range-checked when someone tries to set it.
  const weight = valueOf('weightKg');
  if (weight !== undefined && weight !== null) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 1 || weight > 500) {
      issues.push({ field: 'weightKg', code: 'out_of_range', message: 'weightKg must be a number between 1 and 500' });
    }
  }

  for (const f of ['allergies', 'otherAllergens', 'conditions', 'likes', 'dislikes']) {
    issues.push(...strArrayIssues(input, f));
  }

  const id = valueOf('id');
  if (id !== undefined && id !== null && (typeof id !== 'string' || id === '')) {
    issues.push({ field: 'id', code: 'invalid_type', message: 'id must be a string when given' });
  }

  // 4. Child constraints (PV02) against the effective birth month.
  let ageYears: number | null = null;
  if (typeof birthYm === 'string' && isValidBirthYm(birthYm)) {
    ageYears = deriveAgeYears(birthYm, ctx.now);
    if (ageYears !== null && ageYears < 13) {
      // Only an attempt to SET a blocked field trips the limit; omitting it keeps the
      // row at whatever was already stored.
      for (const key of UNDER13_BLOCKED_KEYS) {
        if (valueOf(key) !== undefined && valueOf(key) !== null) {
          issues.push({
            field: key,
            code: 'child_collection_limit',
            message: `members under 13 do not collect ${key} (PV02 collection limits)`,
          });
        }
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues: ordered(issues) };
  }

  // 5. Normalize (validated values).
  const health: HealthPatch = {};
  const healthKeysTouched: Array<keyof HealthPatch> = [];
  for (const key of HEALTH_KEYS) {
    if (key in input) {
      healthKeysTouched.push(key);
      const v = input[key];
      (health[key] as unknown) = v === null ? null : v;
    }
  }

  const likes = input['likes'] as string[] | undefined;
  const dislikes = input['dislikes'] as string[] | undefined;

  return {
    ok: true,
    ageYears: ageYears ?? 0,
    normalized: {
      id: typeof id === 'string' ? id : updating ? ex.id : null,
      name: String(name).trim(),
      birthYm: String(birthYm),
      sex: sex as Sex,
      activityLevel: activityLevel as ActivityLevel,
      dietPattern:
        dietPattern === undefined ? (ex?.dietPattern ?? null) : dietPattern === null ? null : (dietPattern as DietPattern),
      likes: (likes ?? ctx.existingPrefs?.likes ?? []).map((s) => s.trim()),
      dislikes: (dislikes ?? ctx.existingPrefs?.dislikes ?? []).map((s) => s.trim()),
      profileKeysTouched: PROFILE_KEYS.filter((k) => k in input),
      prefsTouched: 'likes' in input || 'dislikes' in input,
      health,
      healthKeysTouched,
    },
  };
}

// ---------- attendance ----------

export type AttendanceValidationResult =
  | { ok: true; entries: AttendanceEntry[] }
  | { ok: false; issues: ValidationIssue[] };

export function validateAttendanceInput(raw: unknown): AttendanceValidationResult {
  if (!isPlainObject(raw)) {
    return { ok: false, issues: [{ field: '', code: 'invalid_type', message: 'input must be an object' }] };
  }
  const input = raw;
  const issues: ValidationIssue[] = [];
  const entries: AttendanceEntry[] = [];

  if (typeof input['memberId'] !== 'string' || input['memberId'] === '') {
    issues.push({ field: 'memberId', code: 'required', message: 'memberId is required' });
  }
  const list = input['entries'];
  if (!Array.isArray(list)) {
    issues.push({ field: 'entries', code: 'required', message: 'entries must be an array' });
  } else if (list.length === 0) {
    issues.push({ field: 'entries', code: 'out_of_range', message: 'entries must not be empty' });
  } else if (list.length > 28) {
    issues.push({ field: 'entries', code: 'out_of_range', message: 'at most 28 entries per call (4 meal types x 7 days)' });
  } else {
    list.forEach((e, i) => {
      const field = (sub: string) => `entries[${i}].${sub}`;
      if (!isPlainObject(e)) {
        issues.push({ field: `entries[${i}]`, code: 'invalid_type', message: 'entry must be an object' });
        return;
      }
      const mealType = e['mealType'];
      const weekday = e['weekday'];
      const attending = e['attending'];
      const packed = e['packed'];

      if (!MEAL_TYPES.includes(mealType as (typeof MEAL_TYPES)[number])) {
        issues.push({ field: field('mealType'), code: 'not_allowed', message: `mealType must be one of: ${MEAL_TYPES.join(', ')}` });
      }
      if (typeof weekday !== 'number' || !Number.isInteger(weekday) || weekday < WEEKDAY_MIN || weekday > WEEKDAY_MAX) {
        issues.push({ field: field('weekday'), code: 'out_of_range', message: 'weekday must be an integer 1 (Mon) to 7 (Sun)' });
      }
      if (typeof attending !== 'boolean') {
        issues.push({ field: field('attending'), code: 'invalid_type', message: 'attending must be true or false' });
      }
      if (packed !== undefined && packed !== null && typeof packed !== 'boolean') {
        issues.push({ field: field('packed'), code: 'invalid_type', message: 'packed must be a boolean' });
      }
      // MP01: the packed flag marks school/work lunches; other slots don't take it.
      if (packed === true && mealType !== 'lunch') {
        issues.push({ field: field('packed'), code: 'not_allowed', message: 'packed is only for lunch (school/work lunch)' });
      }

      if (MEAL_TYPES.includes(mealType as (typeof MEAL_TYPES)[number]) && typeof weekday === 'number' && typeof attending === 'boolean') {
        entries.push({
          mealType: mealType as AttendanceEntry['mealType'],
          weekday,
          attending,
          packed: packed === true,
        });
      }
    });
  }

  if (issues.length > 0) return { ok: false, issues };
  const seen = new Set<string>();
  for (const e of entries) {
    const k = `${e.mealType}:${e.weekday}`;
    if (seen.has(k)) {
      return { ok: false, issues: [{ field: 'entries', code: 'invalid_type', message: `duplicate entry for ${k}` }] };
    }
    seen.add(k);
  }
  return { ok: true, entries };
}

export type ConsentDataType = 'measurements' | 'allergies' | 'conditions';

export function consentDataTypeForHealthKey(key: keyof HealthPatch): ConsentDataType {
  if (key === 'heightCm' || key === 'weightKg') return 'measurements';
  if (key === 'allergies' || key === 'otherAllergens') return 'allergies';
  return 'conditions';
}

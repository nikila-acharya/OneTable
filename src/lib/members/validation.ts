/**
 * PR01 profile validation. Pure functions, no DB. Field rules:
 * - Create requires the PR01 required set: name, birthYm, sex, activityLevel.
 * - Update: any subset; omitted fields keep their stored value.
 * - Auth-like keys are refused everywhere (PV02: no credentials on a member).
 * - Health keys are refused in this slice: they need the consent gate and the
 *   encrypted health table, which land in WP-1.3.
 */
import { ACTIVITY_LEVELS, DIET_PATTERNS, SEXES, type ActivityLevel, type DietPattern, type Sex } from "./types";

export const NAME_MAX_LEN = 40;
export const PREF_MAX_COUNT = 30;
export const PREF_MAX_LEN = 40;
const BIRTH_YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_AGE_YEARS = 120;

export const AUTH_FIELD_NAMES = [
  "email", "phone", "password", "passwordHash", "username", "login",
  "ssn", "deviceId", "geolocation", "address",
] as const;
export const HEALTH_FIELD_NAMES = ["heightCm", "weightKg", "allergies", "otherAllergens", "conditions"] as const;
const PROFILE_KEYS = ["name", "birthYm", "sex", "activityLevel", "dietPattern", "likes", "dislikes", "memberId"] as const;

export interface ValidationIssue {
  field: string;
  code: "required" | "invalid" | "not_allowed" | "auth_fields_forbidden" | "health_fields_not_available";
  message: string;
}

export interface NormalizedProfile {
  name?: string;
  birthYm?: string;
  sex?: Sex;
  activityLevel?: ActivityLevel;
  dietPattern?: DietPattern;
  likes?: string[];
  dislikes?: string[];
}

export type ValidationResult =
  | { ok: true; value: NormalizedProfile }
  | { ok: false; issues: ValidationIssue[] };

function normalizeTags(field: string, raw: unknown, issues: ValidationIssue[]): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) {
    issues.push({ field, code: "invalid", message: `${field} must be a list of text items` });
    return undefined;
  }
  const seen = new Set<string>();
  for (const item of raw as string[]) {
    const t = item.trim().toLowerCase();
    if (t.length === 0 || t.length > PREF_MAX_LEN) {
      issues.push({ field, code: "invalid", message: `each ${field} item must be 1-${PREF_MAX_LEN} characters` });
      return undefined;
    }
    seen.add(t);
  }
  if (seen.size > PREF_MAX_COUNT) {
    issues.push({ field, code: "invalid", message: `at most ${PREF_MAX_COUNT} ${field} items` });
    return undefined;
  }
  return [...seen].sort();
}

export function validateProfile(
  input: Record<string, unknown>,
  mode: "create" | "update",
  now: Date,
): ValidationResult {
  const issues: ValidationIssue[] = [];

  for (const key of Object.keys(input)) {
    if ((AUTH_FIELD_NAMES as readonly string[]).includes(key)) {
      issues.push({ field: key, code: "auth_fields_forbidden", message: "members never hold sign-in details (PV02)" });
    } else if ((HEALTH_FIELD_NAMES as readonly string[]).includes(key)) {
      issues.push({
        field: key,
        code: "health_fields_not_available",
        message: "health details are saved in a later step, with their own consent",
      });
    } else if (!(PROFILE_KEYS as readonly string[]).includes(key)) {
      issues.push({ field: key, code: "not_allowed", message: `unknown field ${key}` });
    }
  }

  if (mode === "create") {
    for (const req of ["name", "birthYm", "sex", "activityLevel"]) {
      if (input[req] === undefined) issues.push({ field: req, code: "required", message: `${req} is required` });
    }
  }

  const out: NormalizedProfile = {};

  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0 || input.name.trim().length > NAME_MAX_LEN) {
      issues.push({ field: "name", code: "invalid", message: `name must be 1-${NAME_MAX_LEN} characters` });
    } else out.name = input.name.trim();
  }

  if (input.birthYm !== undefined) {
    const v = input.birthYm;
    if (typeof v !== "string" || !BIRTH_YM_RE.test(v)) {
      issues.push({ field: "birthYm", code: "invalid", message: "birth month must look like YYYY-MM" });
    } else {
      const [y, m] = v.split("-").map(Number) as [number, number];
      const monthStart = Date.UTC(y, m - 1, 1);
      const nowMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
      const ageYears = (nowMonthStart - monthStart) / (365.25 * 24 * 3600 * 1000);
      if (monthStart > nowMonthStart) {
        issues.push({ field: "birthYm", code: "invalid", message: "birth month cannot be in the future" });
      } else if (ageYears > MAX_AGE_YEARS) {
        issues.push({ field: "birthYm", code: "invalid", message: "birth month is not plausible" });
      } else out.birthYm = v;
    }
  }

  if (input.sex !== undefined) {
    if (!(SEXES as readonly string[]).includes(input.sex as string)) {
      issues.push({ field: "sex", code: "invalid", message: `sex must be one of ${SEXES.join(", ")}` });
    } else out.sex = input.sex as Sex;
  }

  if (input.activityLevel !== undefined) {
    if (!(ACTIVITY_LEVELS as readonly string[]).includes(input.activityLevel as string)) {
      issues.push({ field: "activityLevel", code: "invalid", message: `activity must be one of ${ACTIVITY_LEVELS.join(", ")}` });
    } else out.activityLevel = input.activityLevel as ActivityLevel;
  }

  if (input.dietPattern !== undefined) {
    if (!(DIET_PATTERNS as readonly string[]).includes(input.dietPattern as string)) {
      issues.push({ field: "dietPattern", code: "invalid", message: `diet must be one of ${DIET_PATTERNS.join(", ")}` });
    } else out.dietPattern = input.dietPattern as DietPattern;
  }

  const likes = normalizeTags("likes", input.likes, issues);
  if (likes !== undefined) out.likes = likes;
  const dislikes = normalizeTags("dislikes", input.dislikes, issues);
  if (dislikes !== undefined) out.dislikes = dislikes;

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: out };
}

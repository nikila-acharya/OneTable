// Age derivation from birth_ym (PR01: "Birth year + month — age is derived").
// Injectable clock so child-constraint boundaries (PV02 under-13) are testable.

const BIRTH_YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MIN_BIRTH_YEAR = 1900;

export function parseBirthYm(birthYm: string): { year: number; month: number } | null {
  const m = BIRTH_YM_RE.exec(birthYm);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (year < MIN_BIRTH_YEAR || year > 2100) return null;
  return { year, month };
}

export function isValidBirthYm(birthYm: unknown): birthYm is string {
  return typeof birthYm === 'string' && parseBirthYm(birthYm) !== null;
}

/**
 * Whole years of age at `now`, from a "YYYY-MM" birth month.
 * Age is measured from the first of the birth month: someone born 2013-10 is 13
 * on 2026-10-01. Returns null when birthYm is invalid.
 */
export function deriveAgeYears(birthYm: string, now: Date): number | null {
  const parsed = parseBirthYm(birthYm);
  if (!parsed) return null;
  let age = now.getUTCFullYear() - parsed.year;
  const monthNow = now.getUTCMonth() + 1;
  if (monthNow < parsed.month) age -= 1;
  return age;
}

export function isFutureBirthYm(birthYm: string, now: Date): boolean {
  const parsed = parseBirthYm(birthYm);
  if (!parsed) return false;
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  return parsed.year > y || (parsed.year === y && parsed.month > m);
}

export function isImprobablyOld(birthYm: string, now: Date): boolean {
  const age = deriveAgeYears(birthYm, now);
  return age !== null && age > 120;
}

// PV02 collection tiers.
export const CHILD_MAX_AGE_EXCLUSIVE = 13; // under 13: collection limits
export const MINOR_MAX_AGE_EXCLUSIVE = 18; // under 18: profile only, no credentials

export function isUnder13(birthYm: string, now: Date): boolean {
  const age = deriveAgeYears(birthYm, now);
  return age !== null && age < CHILD_MAX_AGE_EXCLUSIVE;
}

export function isUnder18(birthYm: string, now: Date): boolean {
  const age = deriveAgeYears(birthYm, now);
  return age !== null && age < MINOR_MAX_AGE_EXCLUSIVE;
}

// WP-0.4 — the "single User per household" invariant (AC01/PV02).
// Two layers are tested without a live Postgres:
//   1. the pure pre-check in lib/auth/users.ts,
//   2. the DB-level guarantee: the UNIQUE index declared in db/schema/auth.ts
//      (asserted at source level — if a refactor drops it, this fails loudly).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HouseholdAlreadyHasUserError, assertSingleUserPerHousehold } from '@/lib/auth/users';

describe('assertSingleUserPerHousehold', () => {
  it('allows the first User of a household', () => {
    expect(() => assertSingleUserPerHousehold(null)).not.toThrow();
    expect(() => assertSingleUserPerHousehold(undefined)).not.toThrow();
    expect(() => assertSingleUserPerHousehold([])).not.toThrow();
  });

  it('refuses a second User for the same household', () => {
    expect(() => assertSingleUserPerHousehold([{ householdId: 'h-1' }])).toThrow(
      HouseholdAlreadyHasUserError,
    );
    expect(() => assertSingleUserPerHousehold([{ householdId: 'h-1' }])).toThrow(/h-1/);
  });
});

describe('db/schema.ts constraint declarations (user table)', () => {
  const schemaSource = readFileSync(
    resolve(process.cwd(), 'db', 'schema.ts'),
    'utf8',
  );

  it('has a UNIQUE index on user.household_id (one login per household)', () => {
    expect(schemaSource).toMatch(/uniqueIndex\(['"]user_one_per_household['"]\)\.on\(t\.householdId\)/);
  });

  it('has a UNIQUE index on user.email (login identifier is unique)', () => {
    expect(schemaSource).toMatch(/uniqueIndex\(['"]user_email_key['"]\)\.on\(t\.email\)/);
  });

  it('keeps member profiles free of auth fields (PV02: no credentials on member)', () => {
    const start = schemaSource.indexOf("export const member = pgTable(");
    expect(start).toBeGreaterThan(-1);
    const end = schemaSource.indexOf("\n);\n", start);
    const memberBlock = schemaSource.slice(start, end);
    expect(memberBlock).not.toMatch(/password|email|passwordHash|session|token/i);
  });
});

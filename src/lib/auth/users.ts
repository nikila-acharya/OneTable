// lib/auth/users.ts — user repository + the "single User per household"
// invariant (AC01: one account per household, owned by one User; PV02: only
// `user` can authenticate). Owned by WP-0.4.
//
// The DB-level enforcement is the unique index on user.household_id
// (db/schema/auth.ts). The helpers here pre-check it so callers get a typed
// error instead of a raw constraint violation.
import { eq } from 'drizzle-orm';
import { appUser as users } from '../../../db/schema';
import { getDb } from './db';
import { normalizeEmail } from './email';
import { getDummyPasswordHash, hashPassword, verifyPassword } from './password';

/** The household already has its one User. Surfaced as a friendly error before
 * insert; the unique index is the final arbiter under races. */
export class HouseholdAlreadyHasUserError extends Error {
  constructor(public readonly householdId: string) {
    super(`household ${householdId} already has a User — AC01 allows exactly one login per household`);
    this.name = 'HouseholdAlreadyHasUserError';
  }
}

export interface AuthenticUser {
  id: string;
  email: string;
  householdId: string;
}

/**
 * Pure invariant check (task title: "single User per household").
 * `existingForHousehold` is whatever the caller already loaded for that
 * household (0 or 1 row). Throws when a second User would be created.
 */
export function assertSingleUserPerHousehold(
  existingForHousehold: readonly { householdId: string }[] | null | undefined,
): void {
  if (existingForHousehold && existingForHousehold.length > 0) {
    throw new HouseholdAlreadyHasUserError(existingForHousehold[0]!.householdId);
  }
}

export async function findUserByHousehold(householdId: string): Promise<typeof users.$inferSelect | null> {
  const rows = await getDb().select().from(users).where(eq(users.householdId, householdId)).limit(2);
  return rows[0] ?? null;
}

export async function findUserByEmail(email: string): Promise<typeof users.$inferSelect | null> {
  const rows = await getDb().select().from(users).where(eq(users.email, normalizeEmail(email))).limit(1);
  return rows[0] ?? null;
}

/**
 * Create the household's single User (called by onboarding / seed scripts —
 * NOT by sign-in; see the adapter guard in config.ts).
 * `password` is optional: magic-link-only users have passwordHash NULL.
 */
export async function createHouseholdUser(input: {
  householdId: string;
  email: string;
  name?: string;
  password?: string;
}): Promise<AuthenticUser> {
  const email = normalizeEmail(input.email);
  const existing = await findUserByHousehold(input.householdId);
  assertSingleUserPerHousehold(existing ? [existing] : []);
  const passwordHash = input.password === undefined ? null : await hashPassword(input.password);
  const inserted = await getDb()
    .insert(users)
    .values({
      householdId: input.householdId,
      email,
      name: input.name ?? null,
      passwordHash,
      // A credentials user's email is proven by whoever typed the password at
      // signup; magic-link users get emailVerified from the link flow.
      emailVerified: input.password !== undefined ? new Date() : null,
    })
    .returning({ id: users.id, email: users.email, householdId: users.householdId });
  return inserted[0]!;
}

/**
 * Credentials sign-in path (used by the Auth.js Credentials provider).
 * Always performs one scrypt verification so a wrong password and an unknown
 * email take the same time (anti-enumeration).
 */
export async function verifyCredentials(input: {
  email: unknown;
  password: unknown;
}): Promise<AuthenticUser | null> {
  let email: string | null = null;
  try {
    email = typeof input.email === 'string' ? normalizeEmail(input.email) : null;
  } catch {
    email = null;
  }
  const password = typeof input.password === 'string' ? input.password : '';
  const user = email ? await findUserByEmail(email) : null;
  const storedHash = user?.passwordHash ?? (await getDummyPasswordHash());
  const ok = await verifyPassword(password, storedHash);
  if (!ok || !user || user.passwordHash === null) return null;
  return { id: user.id, email: user.email, householdId: user.householdId };
}

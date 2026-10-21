/**
 * WP-1.6 sign-up: creates a household and its single User together (AC01).
 * Sign-in never creates accounts (ADR-002 / lib/auth), so this is the only
 * account-creation path. Password rules: at least 10 characters (ADR-009).
 */
import { eq } from "drizzle-orm";
import { appUser, household } from "../../../db/schema";
import type { Db } from "../db";
import { normalizeEmail } from "../auth/email";
import { hashPassword } from "../auth/password";

export const MIN_PASSWORD_CHARS = 10;

export class EmailTakenError extends Error {
  readonly code = "email_taken" as const;
  constructor() {
    super("that email already has an account");
    this.name = "EmailTakenError";
  }
}

export class SignupRejectedError extends Error {
  readonly code = "signup_rejected" as const;
  constructor(readonly issues: string[]) {
    super(`sign-up not accepted: ${issues.join("; ")}`);
    this.name = "SignupRejectedError";
  }
}

export async function signUpHousehold(
  db: Db,
  input: { email: unknown; password: unknown; householdName?: unknown },
): Promise<{ householdId: string; userId: string }> {
  const issues: string[] = [];
  if (typeof input.email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(input.email.trim())) {
    issues.push("email is not valid");
  }
  if (typeof input.password !== "string" || input.password.length < MIN_PASSWORD_CHARS) {
    issues.push(`password must be at least ${MIN_PASSWORD_CHARS} characters`);
  }
  if (issues.length > 0) throw new SignupRejectedError(issues);

  const email = normalizeEmail(input.email as string);
  const [taken] = await db.select({ id: appUser.id }).from(appUser).where(eq(appUser.email, email)).limit(1);
  if (taken) throw new EmailTakenError();

  const name = typeof input.householdName === "string" && input.householdName.trim() ? input.householdName.trim().slice(0, 80) : "My household";
  const passwordHash = await hashPassword(input.password as string);

  const [hh] = await db.insert(household).values({ name, tier: "free", timezone: "UTC" }).returning({ id: household.id });
  try {
    const [user] = await db
      .insert(appUser)
      .values({ householdId: hh!.id, email, passwordHash, emailVerified: new Date() })
      .returning({ id: appUser.id });
    return { householdId: hh!.id, userId: user!.id };
  } catch (e) {
    // Unique email race or other insert failure: don't leave an orphan household.
    await db.delete(household).where(eq(household.id, hh!.id));
    if (String((e as { code?: unknown }).code) === "23505") throw new EmailTakenError();
    throw e;
  }
}

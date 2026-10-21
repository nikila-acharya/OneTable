/**
 * PV03 erasure. Deleting the household cascades to every household-owned table
 * (checked by a DB-wide test). Two parts need explicit handling:
 * - consent is append-only, so the cascade must opt in via the transaction-local
 *   setting onetable.allow_consent_delete;
 * - sign-in tokens are keyed by email, not by household, so they are removed by
 *   the household user's email before the household row goes.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { appUser, household, verificationTokens } from "../../../db/schema";
import type { Db } from "../db";

export async function eraseHousehold(db: Db, householdId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('onetable.allow_consent_delete', 'on', true)`);
    const users = await tx.select({ email: appUser.email }).from(appUser).where(eq(appUser.householdId, householdId));
    const emails = users.map((u) => u.email);
    if (emails.length > 0) {
      await tx.delete(verificationTokens).where(inArray(verificationTokens.identifier, emails));
    }
    await tx.delete(household).where(eq(household.id, householdId));
  });
}

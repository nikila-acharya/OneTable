/**
 * PV03 erasure seam. Deleting a household cascades into consent, and the
 * append-only trigger would block that. Erasure runs inside a transaction
 * that opts in via onetable.allow_consent_delete (local to the transaction).
 * WP-1.5 extends this to every household-owned table.
 */
import { eq, sql } from "drizzle-orm";
import { household } from "../../../db/schema";
import type { Db } from "../db";

export async function eraseHousehold(db: Db, householdId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('onetable.allow_consent_delete', 'on', true)`);
    await tx.delete(household).where(eq(household.id, householdId));
  });
}

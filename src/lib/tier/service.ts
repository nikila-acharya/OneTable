/**
 * Server-side tier checks (AC01: "tier checks happen on the server, not only in
 * the UI"). The household row is locked for the duration of the caller's
 * transaction, so two concurrent adds cannot both pass the limit.
 */
import { eq, sql } from "drizzle-orm";
import { household, member } from "../../../db/schema";
import type { Db } from "../db";
import { MEMBER_LIMIT, TierLimitError, type Tier } from "./limits";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Call inside the write's transaction, before inserting a member. */
export async function assertMemberCapacity(tx: Tx, householdId: string): Promise<void> {
  const [hh] = await tx
    .select({ tier: household.tier })
    .from(household)
    .where(eq(household.id, householdId))
    .for("update");
  if (!hh) throw new Error("household not found");
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.householdId, householdId));
  const limit = MEMBER_LIMIT[hh.tier as Tier];
  if (n >= limit) throw new TierLimitError(hh.tier as Tier, limit);
}

/**
 * Billing stub (PRD 7.x, WP-7.2). Not reachable from any agent tool (X-level):
 * only the billing webhook, or an operator, may change a tier.
 */
export async function setHouseholdTier(db: Db, householdId: string, tier: Tier): Promise<void> {
  await db.update(household).set({ tier }).where(eq(household.id, householdId));
}

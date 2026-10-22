/** What the server actually stored for the household (WP-1.6 Done screen). Read-only. */
import { eq } from "drizzle-orm";
import { household } from "../../../db/schema";
import type { Db } from "../db";
import { listMembers } from "../members/service";
import { getHouseholdSettings, type HouseholdSettings } from "../household/settings";

export interface OnboardingSummary {
  householdName: string;
  tier: string;
  memberNames: string[];
  settings: HouseholdSettings;
}

export async function getOnboardingSummary(db: Db, householdId: string): Promise<OnboardingSummary> {
  const [hh] = await db.select().from(household).where(eq(household.id, householdId));
  if (!hh) throw new Error("household not found");
  const members = await listMembers(db, householdId);
  return {
    householdName: hh.name,
    tier: hh.tier,
    memberNames: members.map((m) => m.name),
    settings: await getHouseholdSettings(db, householdId),
  };
}

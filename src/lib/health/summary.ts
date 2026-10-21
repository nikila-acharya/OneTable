/**
 * get_member_summary (R-level, PRD 7.2 / NF-P5): flags only. No heights,
 * weights, condition names or allergy severities reach the agent. The allergen
 * name is included because planning must know it (the PRD's own example is
 * "has peanut allergy").
 */
import type { Db } from "../db";
import { getMember } from "../members/service";
import { evaluateConditionGate } from "../conditions/gate";
import { readHealth } from "./service";

export interface MemberSummary {
  memberId: string;
  isChild: boolean;
  flags: string[];
}

export async function getMemberSummary(db: Db, householdId: string, memberId: string): Promise<MemberSummary> {
  const profile = await getMember(db, householdId, memberId);
  const health = await readHealth(db, householdId, memberId);
  const gate = evaluateConditionGate(memberId, health.conditions);
  const flags: string[] = [];
  if (profile.isChild) flags.push("under_18");
  for (const a of health.allergies) flags.push(`allergy:${a.replace(/ /g, "_")}`);
  if (health.otherAllergens.length > 0) flags.push("allergy:other_listed");
  if (gate.glutenHardFilter) flags.push("hard_filter:gluten");
  if (health.conditions.length > 0) flags.push("has_listed_condition");
  if (gate.mode === "general_guidance") flags.push("general_guidance_mode", "clinician_confirm_banner");
  return { memberId, isChild: profile.isChild, flags: [...new Set(flags)].sort() };
}

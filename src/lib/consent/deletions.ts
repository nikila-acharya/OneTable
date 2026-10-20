/**
 * Withdrawal deletes the data type in the same transaction as the withdrawal
 * event (PV01). Health fields live in one encrypted blob per member
 * (member_health), so those are rewritten, not dropped.
 */
import { and, eq, inArray } from "drizzle-orm";
import {
  activityCheckin,
  activityGoal,
  agentConversation,
  agentMessage,
  member,
  memberHealth,
  memoryEntry,
} from "../../../db/schema";
import { decryptHealth, encryptHealth } from "../../../db/crypto";
import type { Executor } from "./store";
import type { ConsentDataType } from "./types";

async function healthRows(ex: Executor, householdId: string) {
  const members = await ex.select({ id: member.id }).from(member).where(eq(member.householdId, householdId));
  if (members.length === 0) return [];
  return ex
    .select()
    .from(memberHealth)
    .where(inArray(memberHealth.memberId, members.map((m) => m.id)));
}

async function rewriteHealth(
  ex: Executor,
  householdId: string,
  edit: (data: ReturnType<typeof decryptHealth>) => ReturnType<typeof decryptHealth>,
): Promise<void> {
  for (const row of await healthRows(ex, householdId)) {
    const next = edit(decryptHealth(row.dataEnc));
    await ex
      .update(memberHealth)
      .set({ dataEnc: encryptHealth(next), updatedAt: new Date() })
      .where(eq(memberHealth.memberId, row.memberId));
  }
}

export const DELETIONS: Record<ConsentDataType, (ex: Executor, householdId: string) => Promise<void>> = {
  health_conditions: (ex, hh) => rewriteHealth(ex, hh, (d) => ({ ...d, conditions: [] })),
  allergies: (ex, hh) => rewriteHealth(ex, hh, (d) => ({ ...d, allergies: [], otherAllergens: [] })),
  body_measurements: (ex, hh) => rewriteHealth(ex, hh, (d) => ({ ...d, heightCm: null, weightKg: null })),
  activity_data: async (ex, hh) => {
    const members = await ex.select({ id: member.id }).from(member).where(eq(member.householdId, hh));
    const ids = members.map((m) => m.id);
    if (ids.length === 0) return;
    await ex.delete(activityCheckin).where(inArray(activityCheckin.memberId, ids));
    await ex.delete(activityGoal).where(inArray(activityGoal.memberId, ids));
  },
  // Agent processing: stored agent conversations and memory are household data
  // the agent produced. Withdrawal removes them. (Decision flagged for owner.)
  agent_processing: async (ex, hh) => {
    const convs = await ex
      .select({ id: agentConversation.id })
      .from(agentConversation)
      .where(eq(agentConversation.householdId, hh));
    const convIds = convs.map((c) => c.id);
    if (convIds.length > 0) await ex.delete(agentMessage).where(inArray(agentMessage.conversationId, convIds));
    await ex.delete(agentConversation).where(eq(agentConversation.householdId, hh));
    await ex.delete(memoryEntry).where(and(eq(memoryEntry.householdId, hh)));
  },
};

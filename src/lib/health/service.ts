/**
 * Encrypted health storage (NF-P1). One AES-256-GCM blob per member. Every
 * write goes through the consent gate in the same transaction (PV01): a refused
 * write stores nothing.
 */
import { and, eq } from "drizzle-orm";
import { member, memberHealth, type MemberHealthData } from "../../../db/schema";
import { decryptHealth, encryptHealth } from "../../../db/crypto";
import type { Db } from "../db";
import { guardProfileWrite } from "../consent/gate";
import { MemberError } from "../members/types";
import type { HealthPatch } from "./validation";

const EMPTY: MemberHealthData = { heightCm: null, weightKg: null, conditions: [], allergies: [], otherAllergens: [] };

async function ownedMember(ex: Pick<Db, "select">, householdId: string, memberId: string) {
  const [row] = await ex
    .select()
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.householdId, householdId)));
  if (!row) throw new MemberError("not_found", "member not found");
  return row;
}

export async function readHealth(db: Db, householdId: string, memberId: string): Promise<MemberHealthData> {
  await ownedMember(db, householdId, memberId);
  const [row] = await db.select().from(memberHealth).where(eq(memberHealth.memberId, memberId));
  return row ? decryptHealth(row.dataEnc) : { ...EMPTY };
}

export async function writeHealth(
  db: Db,
  householdId: string,
  memberId: string,
  patch: HealthPatch,
): Promise<void> {
  await db.transaction(async (tx) => {
    await ownedMember(tx, householdId, memberId);
    // PV01: consent is checked before anything is read-modified-written.
    await guardProfileWrite(tx, householdId, patch as Record<string, unknown>);
    const [row] = await tx.select().from(memberHealth).where(eq(memberHealth.memberId, memberId));
    const current = row ? decryptHealth(row.dataEnc) : { ...EMPTY };
    const next: MemberHealthData = { ...current, ...patch };
    await tx
      .insert(memberHealth)
      .values({ memberId, dataEnc: encryptHealth(next), updatedAt: new Date() })
      .onConflictDoUpdate({
        target: memberHealth.memberId,
        set: { dataEnc: encryptHealth(next), updatedAt: new Date() },
      });
  });
}


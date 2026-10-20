/**
 * The only way to grant or withdraw consent. HTTP and agent tools both call
 * these; no agent tool may call them (PRD 7.2: consent is X-level for agents).
 */
import type { Db } from "../db";
import { DELETIONS } from "./deletions";
import { recordEvent } from "./store";
import type { ConsentDataType } from "./types";
import { currentPolicyVersion } from "./policy";

export async function grantConsent(db: Db, householdId: string, dataType: ConsentDataType): Promise<void> {
  await recordEvent(db, householdId, dataType, true, currentPolicyVersion());
}

/** Withdrawal event + deletion of the data type, all-or-nothing. */
export async function withdrawConsent(db: Db, householdId: string, dataType: ConsentDataType): Promise<void> {
  await db.transaction(async (tx) => {
    await recordEvent(tx, householdId, dataType, false, currentPolicyVersion());
    await DELETIONS[dataType](tx, householdId);
  });
}

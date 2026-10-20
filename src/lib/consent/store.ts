/**
 * NF-P3 append-only consent log. Writes are inserts only; the effective state
 * is the latest event per (household, data type), counted as granted only if
 * it is a grant recorded under the current policy version.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { consent } from "../../../db/schema";
import type { Db } from "../db";
import { currentPolicyVersion } from "./policy";
import { CONSENT_DATA_TYPES, type ConsentDataType } from "./types";

export interface ConsentState {
  dataType: ConsentDataType;
  granted: boolean;
  requiresReconsent: boolean;
  policyVersion: string | null;
  at: string | null;
}

/** Either the root DB or a transaction handle. */
export type Executor = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function recordEvent(
  ex: Executor,
  householdId: string,
  dataType: ConsentDataType,
  granted: boolean,
  policyVersion: string = currentPolicyVersion(),
): Promise<void> {
  // clock_timestamp(): distinct per insert, so "latest" is unambiguous even
  // inside one transaction (now() would tie).
  await ex.insert(consent).values({
    householdId,
    dataType,
    granted,
    policyVersion,
    at: sql`clock_timestamp()`,
  });
}

export async function latestEvent(ex: Executor, householdId: string, dataType: ConsentDataType) {
  const rows = await ex
    .select()
    .from(consent)
    .where(and(eq(consent.householdId, householdId), eq(consent.dataType, dataType)))
    .orderBy(desc(consent.at))
    .limit(1);
  return rows[0] ?? null;
}

export async function effectiveStates(
  ex: Executor,
  householdId: string,
  policyVersion: string = currentPolicyVersion(),
): Promise<ConsentState[]> {
  const out: ConsentState[] = [];
  for (const dataType of CONSENT_DATA_TYPES) {
    const last = await latestEvent(ex, householdId, dataType);
    const current = last?.policyVersion === policyVersion;
    out.push({
      dataType,
      granted: Boolean(last?.granted && current),
      requiresReconsent: Boolean(last?.granted && !current),
      policyVersion: last?.policyVersion ?? null,
      at: last ? last.at.toISOString() : null,
    });
  }
  return out;
}

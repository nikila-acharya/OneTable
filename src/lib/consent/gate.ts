/**
 * Consent gates (PV01). Call the gate BEFORE the write: a gated write that
 * fails stores nothing.
 */
import type { Executor } from "./store";
import { effectiveStates } from "./store";
import type { ConsentDataType } from "./types";

export class ConsentRequiredError extends Error {
  readonly code = "consent_required" as const;
  readonly status = 403 as const;
  constructor(readonly dataTypes: ConsentDataType[]) {
    super(`consent required: ${dataTypes.join(", ")}`);
    this.name = "ConsentRequiredError";
  }
}

export async function requireConsent(
  ex: Executor,
  householdId: string,
  dataTypes: ConsentDataType[],
): Promise<void> {
  const states = await effectiveStates(ex, householdId);
  const missing = dataTypes.filter((t) => !states.find((s) => s.dataType === t)?.granted);
  if (missing.length > 0) throw new ConsentRequiredError(missing);
}

/** Profile fields that carry consent-gated data (PRD 10.3 / PR01-PR03). */
export const FIELD_CONSENT: Record<string, ConsentDataType> = {
  conditions: "health_conditions",
  allergies: "allergies",
  otherAllergens: "allergies",
  heightCm: "body_measurements",
  weightKg: "body_measurements",
};

/** Which consents a profile write needs, from the fields it touches. */
export function consentForFields(fields: Record<string, unknown>): ConsentDataType[] {
  const needed = new Set<ConsentDataType>();
  for (const key of Object.keys(fields)) {
    const t = FIELD_CONSENT[key];
    if (t) needed.add(t);
  }
  return [...needed];
}

export async function guardProfileWrite(
  ex: Executor,
  householdId: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await requireConsent(ex, householdId, consentForFields(fields));
}

/** NF-P8: every LLM-processed household call needs agent_processing consent. */
export async function assertAgentRunAllowed(ex: Executor, householdId: string): Promise<void> {
  await requireConsent(ex, householdId, ["agent_processing"]);
}

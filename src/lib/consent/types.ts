/**
 * PV01 consent data types (PRD 5.1). The list must match the Postgres enum
 * consent_data_type (db/schema.ts); tests/consent asserts that.
 */
export const CONSENT_DATA_TYPES = [
  "health_conditions",
  "allergies",
  "body_measurements",
  "activity_data",
  "agent_processing",
] as const;

export type ConsentDataType = (typeof CONSENT_DATA_TYPES)[number];

export function isConsentDataType(value: unknown): value is ConsentDataType {
  return typeof value === "string" && (CONSENT_DATA_TYPES as readonly string[]).includes(value);
}

/** Plain-language labels for the consent panel (PRD 5.1: plain, separate opt-ins). */
export const CONSENT_LABELS: Record<ConsentDataType, string> = {
  health_conditions: "Health conditions",
  allergies: "Allergies",
  body_measurements: "Height and weight",
  activity_data: "Activity goals and check-ins",
  agent_processing: "Let the planning agent use our household data",
};

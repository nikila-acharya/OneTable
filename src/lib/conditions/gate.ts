/**
 * SG01 condition gate. Deterministic: no LLM anywhere in this file. Every
 * member view and every planner call evaluates it.
 */
import { CONDITIONS, GLUTEN_HARD_FILTER_CONDITION, type Condition } from "../health/enums";
import { CONDITION_POLICIES } from "./policy";
import { CLINICIAN_BANNER_COPY } from "./copy";

export type GateMode = "general_guidance" | "normal";

export interface ConditionGateResult {
  readonly memberId: string;
  readonly mode: GateMode;
  readonly showClinicianBanner: boolean;
  readonly triggers: readonly Condition[];
  readonly glutenHardFilter: boolean;
  readonly dgaAwareness: readonly string[];
  /** Values outside the PR03 enum. Validation should have refused them; if one arrives, the gate fails safe. */
  readonly unrecognized: readonly string[];
  readonly bannerCopy: string;
}

const isCondition = (v: unknown): v is Condition =>
  typeof v === "string" && (CONDITIONS as readonly string[]).includes(v);

export function evaluateConditionGate(
  memberId: string,
  conditions: readonly unknown[] | null | undefined,
): ConditionGateResult {
  const recognized = new Set<Condition>();
  const unrecognized: string[] = [];
  for (const c of conditions ?? []) {
    if (isCondition(c)) recognized.add(c);
    else unrecognized.push(String(c));
  }

  const triggers: Condition[] = [];
  let glutenHardFilter = false;
  const dga = new Set<string>();
  // Enum order keeps `triggers` deterministic whatever order the input had.
  for (const c of CONDITIONS) {
    if (!recognized.has(c)) continue;
    const policy = CONDITION_POLICIES[c];
    if (policy.generalGuidance) triggers.push(c);
    if (policy.glutenHardFilter || c === GLUTEN_HARD_FILTER_CONDITION) glutenHardFilter = true;
    for (const area of policy.dgaAwareness) dga.add(area);
  }

  const generalGuidance = triggers.length > 0 || unrecognized.length > 0;
  return {
    memberId,
    mode: generalGuidance ? "general_guidance" : "normal",
    showClinicianBanner: generalGuidance,
    triggers,
    glutenHardFilter,
    dgaAwareness: [...dga].sort(),
    unrecognized,
    bannerCopy: generalGuidance ? CLINICIAN_BANNER_COPY : "",
  };
}

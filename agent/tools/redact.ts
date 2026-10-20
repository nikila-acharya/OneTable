// WP-0.5 — NF-P6 action-log summaries: "Health fields are logged as references,
// never values." Input and result objects are transformed field-name-first before
// anything reaches the action log: every key survives, values of health/PII/secret
// keys are replaced by a type/count descriptor, everything else is kept.

import type { JsonValue } from './json';

/** Keys whose values must never be written to the action log. */
export const REDACTED_KEYS: ReadonlySet<string> = new Set([
  // member identity / health (PRD 5.2, NF-P1, NF-P5)
  'name',
  'memberName',
  'member_name',
  'birth_ym',
  'sex',
  'height',
  'weight',
  'allergies',
  'other_allergens',
  'otherAllergens',
  'conditions',
  'health',
  // free text that can carry health facts or untrusted content (PRD 7.4)
  'content',
  'text',
  'raw_text',
  'rawPage',
  'html',
  'title',
  'ingredients',
  // credentials / secrets
  'email',
  'token',
  'secret',
  'password',
  'apiKey',
  'api_key',
]);

function describe(value: unknown): string {
  if (Array.isArray(value)) return `ref:list(${value.length})`;
  if (value === null) return 'ref:null';
  switch (typeof value) {
    case 'object':
      return `ref:object(${Object.keys(value as object).length})`;
    case 'string':
      return `ref:string(len=${(value as string).length})`;
    case 'number':
    case 'boolean':
      // scalars for redacted keys are still references, not values: e.g. weight 41.2
      return `ref:${typeof value}`;
    default:
      return `ref:${typeof value}`;
  }
}

/** Field-name-first summary of an arbitrary JSON value (PRD 7.7). */
export function summarize(value: unknown): JsonValue {
  if (Array.isArray(value)) return value.map(summarize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, JsonValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACTED_KEYS.has(k) ? describe(v) : summarize(v);
    }
    return out;
  }
  if (value === undefined) return null;
  if (typeof value === 'function') return 'ref:function';
  if (typeof value === 'bigint' || typeof value === 'symbol') return `ref:${typeof value}`;
  return value as JsonValue; // string | number | boolean | null
}

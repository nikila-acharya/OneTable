// WP-0.5 — Shared JSON value type for schema-valid tool inputs, stored proposals
// and action-log summaries (jsonb payloads).

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Minimal JSON-Schema shape used by tool declarations in the skeleton. The full
 * per-tool schemas land with each capability's WP; the registry enforces `required`
 * keys and `type: 'object'` at call time. */
export interface ToolJsonSchema {
  type: 'object';
  properties?: Record<string, { type: 'string' | 'number' | 'boolean' | 'object' | 'array' }>;
  required?: string[];
  additionalProperties?: boolean;
}

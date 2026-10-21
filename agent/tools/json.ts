// WP-0.5 — Shared JSON value type for schema-valid tool inputs, stored proposals
// and action-log summaries (jsonb payloads).

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** Minimal JSON-Schema shape used by tool declarations in the skeleton. The full
 * per-tool schemas land with each capability's WP; the registry enforces `required`
 * keys and `type: 'object'` at call time. */
/** JSON Schema subset the registry validates on every call (approval 2026-10-21, ADR-006-G1). */
export type JsonSchemaType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export interface JsonSchemaNode {
  type?: JsonSchemaType | JsonSchemaType[];
  enum?: readonly (string | number | boolean | null)[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  uniqueItems?: boolean;
}

export interface ToolJsonSchema extends JsonSchemaNode {
  type: 'object';
}

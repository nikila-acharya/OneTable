// WP-1.2 tool registration (PRD 7.2 TR-TOOLS).
// Each tool = typed server function + JSON schema + fixed permission level.
// The agent runtime (WP-0.5/WP-4.1) registers ONLY the specs returned by
// toolsForAgent(): X-level tools are filtered out of agent context entirely —
// "no such tool is registered for that agent" (AC 7.2).
//
// Levels here match the PRD 7.2 table exactly:
//   create_or_update_member  P   (Household Setup agent roster, review card)
//   set_attendance           P   (Household Setup agent roster)
//   list_members / get_member / get_attendance   R
//   delete_member            X   (UI-only — "delete data" is never agent-available)

import type { ToolPermissionLevel } from '../members/action-log';
import { createMemberService, type MemberService, type ToolContext, type ToolResult } from '../members/service';

export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSpec {
  name: string;
  level: ToolPermissionLevel;
  description: string;
  /** JSON schema for LLM tool-calling and API request validation. */
  jsonSchema: JsonSchemaObject;
  /**
   * Execute the tool. Two-phase P-level: call without ctx.approvalId to propose,
   * replay with ctx.approvalId (after the User approves) to apply.
   */
  run: (ctx: ToolContext, input: unknown) => Promise<ToolResult<unknown>>;
}

const memberFieldProperties = {
  id: { type: ['string', 'null'], description: 'Existing member id to update; omit or null to add a new member.' },
  name: { type: 'string', minLength: 1, maxLength: 40, description: 'Display name (required on create).' },
  birthYm: { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$', description: 'Birth year and month, "YYYY-MM". Age is derived; never stored. Required on create.' },
  sex: { type: 'string', enum: ['female', 'male', 'prefer_not_to_say'], description: 'Required on create (DRI lookup).' },
  activityLevel: { type: 'string', enum: ['sedentary', 'low_active', 'active', 'very_active'], description: 'Required on create (DRI PAL categories).' },
  dietPattern: { type: ['string', 'null'], enum: ['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher', 'other', null], description: 'Optional, fixed list.' },
  heightCm: { type: ['number', 'null'], minimum: 30, maximum: 250, description: 'Optional. Needs measurement consent; under-13 members only (optional height).' },
  weightKg: { type: ['number', 'null'], minimum: 1, maximum: 500, description: 'Optional, never required. Needs measurement consent. Members under 13 do not collect weight (PV02).' },
  allergies: { type: ['array', 'null'], items: { type: 'string' }, description: 'Needs allergies consent; enum + encrypted storage are WP-1.3. Never shown to other members.' },
  otherAllergens: { type: ['array', 'null'], items: { type: 'string' }, description: 'Free-text "other" allergen tags (PR02). Needs allergies consent.' },
  conditions: { type: ['array', 'null'], items: { type: 'string' }, description: 'Fixed PR03 list only; enum + storage are WP-1.3. Needs conditions consent.' },
  likes: { type: ['array', 'null'], items: { type: 'string', maxLength: 40 }, description: 'Ingredient or cuisine tags.' },
  dislikes: { type: ['array', 'null'], items: { type: 'string', maxLength: 40 }, description: 'Ingredient or cuisine tags.' },
} as const;

export function buildMemberToolSpecs(service: MemberService): ToolSpec[] {
  const listMembers: ToolSpec = {
    name: 'list_members',
    level: 'R',
    description: 'List the household member profiles (no health values).',
    jsonSchema: { type: 'object', properties: {}, additionalProperties: false },
    run: (ctx) => service.listMembers(ctx),
  };
  const getMember: ToolSpec = {
    name: 'get_member',
    level: 'R',
    description: 'Read one member profile: basics, likes/dislikes, attendance. Health fields are flags-only via get_member_summary (WP-1.3).',
    jsonSchema: {
      type: 'object',
      properties: { memberId: { type: 'string' } },
      required: ['memberId'],
      additionalProperties: false,
    },
    run: (ctx, input) => service.getMember(ctx, (input as { memberId: string }).memberId),
  };
  const getAttendance: ToolSpec = {
    name: 'get_attendance',
    level: 'R',
    description: 'Read a member meal attendance (meal type x weekday, attending, packed).',
    jsonSchema: {
      type: 'object',
      properties: { memberId: { type: 'string' } },
      required: ['memberId'],
      additionalProperties: false,
    },
    run: (ctx, input) => service.getAttendance(ctx, (input as { memberId: string }).memberId),
  };
  const createOrUpdateMember: ToolSpec = {
    name: 'create_or_update_member',
    level: 'P',
    description:
      'Add or update a member profile (PR01). P-level: drafts a review card; nothing saves until the User approves. Auth/contact fields are rejected (PV02); under-13 members carry only planning-necessary fields; health fields need consent (PV01) and the agent cannot grant it.',
    jsonSchema: {
      type: 'object',
      properties: { ...memberFieldProperties },
      // Required-fields-first: server-side create requires name, birthYm, sex,
      // activityLevel (validated in the service, listed here for the model).
      required: [],
      additionalProperties: false,
    },
    run: (ctx, input) => service.createOrUpdateMember(ctx, input),
  };
  const setAttendance: ToolSpec = {
    name: 'set_attendance',
    level: 'P',
    description:
      'Set a member meal attendance per slot type and weekday (PR01/MP01). P-level: nothing changes until the User approves the review card. packed is lunch-only.',
    jsonSchema: {
      type: 'object',
      properties: {
        memberId: { type: 'string' },
        entries: {
          type: 'array',
          minItems: 1,
          maxItems: 28,
          items: {
            type: 'object',
            properties: {
              mealType: { type: 'string', enum: ['breakfast', 'lunch', 'snack', 'dinner'] },
              weekday: { type: 'integer', minimum: 1, maximum: 7, description: 'ISO weekday, 1 = Monday.' },
              attending: { type: 'boolean' },
              packed: { type: 'boolean', description: 'packed is only for lunch (school/work lunch flag).' },
            },
            required: ['mealType', 'weekday', 'attending'],
            additionalProperties: false,
          },
        },
      },
      required: ['memberId', 'entries'],
      additionalProperties: false,
    },
    run: (ctx, input) => service.setAttendance(ctx, input),
  };
  const deleteMember: ToolSpec = {
    name: 'delete_member',
    level: 'X',
    description: 'Delete a member profile and its data. UI-only — X-level: never available to the agent (PRD 7.2).',
    jsonSchema: {
      type: 'object',
      properties: { memberId: { type: 'string' } },
      required: ['memberId'],
      additionalProperties: false,
    },
    run: (ctx, input) => service.deleteMember(ctx, (input as { memberId: string }).memberId),
  };

  return [listMembers, getMember, getAttendance, createOrUpdateMember, setAttendance, deleteMember];
}

/** AC 7.2: X-level tools are not registered for agents. The runtime builds each
 * agent's context from this filtered set (further narrowed by the roster, WP-4.1). */
export function toolsForAgent(specs: ToolSpec[]): ToolSpec[] {
  return specs.filter((s) => s.level !== 'X');
}

export interface WiredMemberTools {
  service: MemberService;
  specs: ToolSpec[];
  agentSpecs: ToolSpec[];
}

/** Convenience wiring for dev/tests with the default (deny-all) consent and no
 * Postgres: pass real ports from the app composition root instead in production. */
export function wireMemberTools(deps: Parameters<typeof createMemberService>[0]): WiredMemberTools {
  const service = createMemberService(deps);
  const specs = buildMemberToolSpecs(service);
  return { service, specs, agentSpecs: toolsForAgent(specs) };
}

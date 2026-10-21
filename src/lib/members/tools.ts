/**
 * Setup-agent tools for member profiles (PRD 7.2). create_or_update_member and
 * set_attendance are P-level: the registry stores a proposal and writes nothing
 * until the household approves it. get_member_summary is R-level (flags only).
 * Handlers re-validate on apply and check consent BEFORE any write.
 */
import type { ToolImplementation, ToolRegistry } from "../../../agent/tools/registry";
import type { Db } from "../db";
import { guardProfileWrite } from "../consent/gate";
import { validateHealthPatch, HEALTH_KEYS } from "../health/validation";
import { writeHealth } from "../health/service";
import { getMemberSummary } from "../health/summary";
import { ALLERGENS, CONDITIONS } from "../health/enums";
import { deriveAgeYears } from "./age";
import { createMember, getMember, setAttendance, updateMember, type AttendanceEntry } from "./service";
import { validateProfile, type NormalizedProfile } from "./validation";
import { ACTIVITY_LEVELS, DIET_PATTERNS, SEXES } from "./types";

type JsonSchema = ToolImplementation["jsonSchema"];

const TAG_SCHEMA = { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 40 } };

const PROFILE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    memberId: { type: "string" },
    name: { type: "string", minLength: 1, maxLength: 40 },
    birthYm: { type: "string", pattern: "^[0-9]{4}-(0[1-9]|1[0-2])$" },
    sex: { type: "string", enum: [...SEXES] },
    activityLevel: { type: "string", enum: [...ACTIVITY_LEVELS] },
    dietPattern: { type: "string", enum: [...DIET_PATTERNS] },
    likes: TAG_SCHEMA,
    dislikes: TAG_SCHEMA,
    // Health (WP-1.3): consent is checked on apply, and values are stored encrypted.
    heightCm: { type: ["number", "null"], minimum: 50, maximum: 250 }, // null clears the value
    weightKg: { type: ["number", "null"], minimum: 2, maximum: 400 },
    conditions: { type: "array", uniqueItems: true, items: { type: "string", enum: [...CONDITIONS] } },
    allergies: { type: "array", uniqueItems: true, items: { type: "string", enum: [...ALLERGENS] } },
    otherAllergens: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 40 } },
  },
  required: [],
} as unknown as JsonSchema;

const ATTENDANCE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    memberId: { type: "string" },
    entries: {
      type: "array",
      maxItems: 28,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          mealType: { type: "string", enum: ["breakfast", "lunch", "snack", "dinner"] },
          weekday: { type: "integer", minimum: 0, maximum: 6 },
          attending: { type: "boolean" },
          packed: { type: "boolean" },
        },
        required: ["mealType", "weekday", "attending"],
      },
    },
  },
  required: ["memberId", "entries"],
} as unknown as JsonSchema;

/** Thrown from a handler: the registry reports it as tool_error; nothing is written. */
export class ProfileRejectedError extends Error {
  constructor(readonly issues: unknown[]) {
    super("profile rejected: " + JSON.stringify(issues));
    this.name = "ProfileRejectedError";
  }
}

export function memberToolImplementations(db: Db, now: () => Date = () => new Date()): ToolImplementation[] {
  const createOrUpdate: ToolImplementation = {
    name: "create_or_update_member",
    level: "P",
    jsonSchema: PROFILE_SCHEMA,
    async handler(input, call) {
      const memberId = typeof input.memberId === "string" ? input.memberId : undefined;
      const profileInput: Record<string, unknown> = {};
      const healthInput: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(input)) {
        if ((HEALTH_KEYS as readonly string[]).includes(k)) healthInput[k] = v;
        else profileInput[k] = v;
      }

      const profile = validateProfile(profileInput, memberId ? "update" : "create", now());
      if (!profile.ok) throw new ProfileRejectedError(profile.issues);

      // Age drives the under-13 weight rule: from the new birth month, or the stored member.
      const birthYm =
        profile.value.birthYm ?? (memberId ? (await getMember(db, call.householdId, memberId)).birthYm : undefined);
      const ageYears = birthYm ? deriveAgeYears(birthYm, now()) : 0;
      const health = validateHealthPatch(healthInput, ageYears);
      if (!health.ok) throw new ProfileRejectedError(health.issues);

      // PV01: consent is checked BEFORE any write, so a refused request stores nothing.
      await guardProfileWrite(db, call.householdId, health.value as Record<string, unknown>);

      let id: string;
      let action: "created" | "updated";
      if (memberId) {
        await updateMember(db, call.householdId, memberId, profile.value, now());
        id = memberId;
        action = "updated";
      } else {
        id = await createMember(db, call.householdId, profile.value as Required<NormalizedProfile> & NormalizedProfile, now());
        action = "created";
      }
      if (Object.keys(health.value).length > 0) await writeHealth(db, call.householdId, id, health.value);
      return { result: { memberId: id, action, healthFieldsStored: Object.keys(health.value) } };
    },
  };

  const attendance: ToolImplementation = {
    name: "set_attendance",
    level: "P",
    jsonSchema: ATTENDANCE_SCHEMA,
    async handler(input, call) {
      const entries = input.entries as AttendanceEntry[];
      const seen = new Set<string>();
      for (const e of entries) {
        const key = `${e.mealType}:${e.weekday}`;
        if (seen.has(key)) throw new ProfileRejectedError([{ field: "entries", code: "invalid", message: "duplicate slot " + key }]);
        seen.add(key);
      }
      await setAttendance(db, call.householdId, input.memberId as string, entries);
      return { result: { memberId: input.memberId, slots: entries.length } };
    },
  };

  const summary: ToolImplementation = {
    name: "get_member_summary",
    level: "R",
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: { memberId: { type: "string" } },
      required: ["memberId"],
    } as unknown as JsonSchema,
    async handler(input, call) {
      return { result: await getMemberSummary(db, call.householdId, input.memberId as string) };
    },
  };

  return [createOrUpdate, attendance, summary];
}

/**
 * Register the member tools for the setup agent (roster: agent/roster.ts).
 * Per-tool register(): registerAgent() would require the whole setup roster.
 */
export function registerMemberTools(registry: ToolRegistry, db: Db, now?: () => Date): void {
  for (const impl of memberToolImplementations(db, now)) registry.register("setup", impl);
}

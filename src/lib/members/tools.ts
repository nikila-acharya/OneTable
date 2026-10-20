/**
 * Setup-agent tools for member profiles (PRD 7.2: create_or_update_member and
 * set_attendance are P-level). The registry runs the approval step; these
 * handlers only run after an approved proposal, so they re-validate here too.
 */
import type { ToolImplementation, ToolRegistry } from "../../../agent/tools/registry";
import type { Db } from "../db";
import { createMember, setAttendance, updateMember, type AttendanceEntry } from "./service";
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
      const v = validateProfile(input, memberId ? "update" : "create", now());
      if (!v.ok) throw new ProfileRejectedError(v.issues);
      if (memberId) {
        await updateMember(db, call.householdId, memberId, v.value, now());
        return { result: { memberId, action: "updated" } };
      }
      const id = await createMember(db, call.householdId, v.value as Required<NormalizedProfile> & NormalizedProfile, now());
      return { result: { memberId: id, action: "created" } };
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

  return [createOrUpdate, attendance];
}

/**
 * Register both member tools for the setup agent (roster: agent/roster.ts).
 * Uses per-tool register(): registerAgent() would require the setup agent's
 * whole roster, and the other setup tools land in later work packages.
 */
export function registerMemberTools(registry: ToolRegistry, db: Db, now?: () => Date): void {
  for (const impl of memberToolImplementations(db, now)) registry.register("setup", impl);
}

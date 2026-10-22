/** WP-1.6 — the onboarding write is all-or-nothing (ADR-008). Live DB. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { household, householdSettings, member, consent } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { completeOnboarding } from "../../src/lib/onboarding/complete";
import { newDraft, newMember, type OnboardingDraft } from "../../src/app/onboarding/store";

// The health write is the step that runs after settings and consent. Make it fail once, on demand.
const inject = vi.hoisted(() => ({ failNextHealthWrite: false }));
vi.mock("../../src/lib/health/service", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../src/lib/health/service")>();
  return {
    ...real,
    writeHealth: async (...args: Parameters<typeof real.writeHealth>) => {
      if (inject.failNextHealthWrite) {
        inject.failNextHealthWrite = false;
        throw new Error("injected failure");
      }
      return real.writeHealth(...args);
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL);
const NOW = new Date("2026-10-21T12:00:00Z");
const created: string[] = [];

function draftWithHealth(): OnboardingDraft {
  const d = newDraft();
  d.household = { ...d.household, name: "Atomic", timezone: "UTC", weekdayBreakfastMinutes: 20, cuisines: ["Thai"] };
  const m = { ...newMember(), name: "Ana", birthYear: 1985, birthMonth: 4, sex: "prefer-not" as const, activity: "low-active" as const, dietaryPattern: "omnivore" as const, allergies: ["peanuts"] };
  d.members = [m];
  d.consent = { allergies: { granted: true, at: NOW.toISOString(), policyVersion: "2026-10-16" } };
  return d;
}

describe.skipIf(!hasDb)("WP-1.6 atomic onboarding write (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  async function newHousehold() {
    const [hh] = await db.insert(household).values({ name: "atomic", tier: "household", timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("a failure partway through leaves nothing: no settings, members or consent", async () => {
    const hid = await newHousehold();
    inject.failNextHealthWrite = true;
    await expect(completeOnboarding(db, hid, draftWithHealth(), NOW)).rejects.toThrow("injected failure");
    expect(await db.select().from(householdSettings).where(eq(householdSettings.householdId, hid))).toHaveLength(0);
    expect(await db.select().from(member).where(eq(member.householdId, hid))).toHaveLength(0);
    expect(await db.select().from(consent).where(eq(consent.householdId, hid))).toHaveLength(0);
    const [hh] = await db.select().from(household).where(eq(household.id, hid));
    expect(hh!.name).toBe("atomic"); // the household name write rolled back too
  });

  it("the same draft succeeds once nothing fails", async () => {
    const hid = await newHousehold();
    const res = await completeOnboarding(db, hid, draftWithHealth(), NOW);
    expect(res).toEqual({ members: 1, consents: 1 });
    expect(await db.select().from(member).where(eq(member.householdId, hid))).toHaveLength(1);
  });
});

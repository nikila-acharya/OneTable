/** WP-1.6 slice 4 — household cooking preferences (PRD 5.0 step 2). Live DB. */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { household, householdSettings } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { getHouseholdSettings, saveHouseholdSettings, SettingsRejectedError, validateSettings } from "../../src/lib/household/settings";
import { completeOnboarding } from "../../src/lib/onboarding/complete";
import { newDraft } from "../../src/app/onboarding/store";

const hasDb = Boolean(process.env.DATABASE_URL);
const created: string[] = [];

describe("validation (pure)", () => {
  it("accepts the PRD defaults", () => {
    expect(validateSettings({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: [], budgetFeel: "" }).ok).toBe(true);
  });
  it("refuses out-of-range and non-integer minutes", () => {
    expect(validateSettings({ weekdayBreakfastMinutes: 2, weeknightDinnerMinutes: 30, cuisines: [] }).ok).toBe(false);
    expect(validateSettings({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30.5, cuisines: [] }).ok).toBe(false);
  });
  it("dedupes cuisines and refuses too many or too long", () => {
    const v = validateSettings({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: ["Thai", " Thai ", "Greek"] });
    expect(v.ok && v.value.cuisines).toEqual(["Thai", "Greek"]);
    const many = Array.from({ length: 21 }, (_, i) => `c${i}`);
    expect(validateSettings({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: many }).ok).toBe(false);
    expect(validateSettings({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: ["x".repeat(31)] }).ok).toBe(false);
  });
  it("budget feel must be a listed choice", () => {
    expect(validateSettings({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: [], budgetFeel: "lots" }).ok).toBe(false);
    const v = validateSettings({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: [], budgetFeel: "balanced" });
    expect(v.ok && v.value.budgetFeel).toBe("balanced");
  });
});

describe.skipIf(!hasDb)("storage (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  async function newHousehold() {
    const [hh] = await db.insert(household).values({ name: "settings", tier: "free", timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("no row yet: the PRD defaults are returned", async () => {
    const hid = await newHousehold();
    expect(await getHouseholdSettings(db, hid)).toEqual({ weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: [], budgetFeel: null });
  });

  it("save, read back, then change again (upsert, one row)", async () => {
    const hid = await newHousehold();
    await saveHouseholdSettings(db, hid, { weekdayBreakfastMinutes: 15, weeknightDinnerMinutes: 25, cuisines: ["Italian", "Mexican"], budgetFeel: "keep-it-cheap" });
    await saveHouseholdSettings(db, hid, { weekdayBreakfastMinutes: 12, weeknightDinnerMinutes: 25, cuisines: ["Thai"], budgetFeel: null });
    expect(await getHouseholdSettings(db, hid)).toEqual({ weekdayBreakfastMinutes: 12, weeknightDinnerMinutes: 25, cuisines: ["Thai"], budgetFeel: null });
    expect(await db.select().from(householdSettings).where(eq(householdSettings.householdId, hid))).toHaveLength(1);
  });

  it("refused input stores nothing and keeps the previous values", async () => {
    const hid = await newHousehold();
    await saveHouseholdSettings(db, hid, { weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: ["Greek"] });
    await expect(saveHouseholdSettings(db, hid, { weekdayBreakfastMinutes: 999, weeknightDinnerMinutes: 30, cuisines: [] })).rejects.toBeInstanceOf(SettingsRejectedError);
    expect((await getHouseholdSettings(db, hid)).cuisines).toEqual(["Greek"]);
  });

  it("onboarding saves the household step's answers", async () => {
    const hid = await newHousehold();
    const d = newDraft();
    d.household = { ...d.household, name: "Onboarded", timezone: "UTC", weekdayBreakfastMinutes: 20, weeknightDinnerMinutes: 45, cuisines: ["Indian"], budgetFeel: "balanced" };
    await completeOnboarding(db, hid, d, new Date("2026-10-21T12:00:00Z"));
    expect(await getHouseholdSettings(db, hid)).toEqual({ weekdayBreakfastMinutes: 20, weeknightDinnerMinutes: 45, cuisines: ["Indian"], budgetFeel: "balanced" });
  });

  it("erasure removes the settings row (PV03)", async () => {
    const hid = await newHousehold();
    await saveHouseholdSettings(db, hid, { weekdayBreakfastMinutes: 10, weeknightDinnerMinutes: 30, cuisines: ["Thai"] });
    await eraseHousehold(db, hid);
    created.splice(created.indexOf(hid), 1);
    expect(await db.select().from(householdSettings).where(eq(householdSettings.householdId, hid))).toHaveLength(0);
  });
});

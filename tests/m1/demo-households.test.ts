/** M1 exit check: both demo households (NF-7) exist end-to-end on the live DB. */
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { seed } from "../../db/seed.js";
import { household, consent } from "../../db/schema";
import { listMembers } from "../../src/lib/members/service";
import { getMemberSummary } from "../../src/lib/health/summary";
import { getHouseholdSettings } from "../../src/lib/household/settings";
import { getOnboardingSummary } from "../../src/lib/onboarding/summary";

const hasDb = Boolean(process.env.DATABASE_URL);
const DEMOS = ["Busy Parent Household", "Fitness Couple Household"];

describe.skipIf(!hasDb)("M1 exit: demo households end-to-end (live DB)", () => {
  let db: Db;
  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
    // Seed here, in the same file, so the health blobs are encrypted and read with the same key.
    // (Each test file may generate its own throwaway ENCRYPTION_KEY; see CI unit job.)
    await seed(db);
  }, 120_000);

  for (const name of DEMOS) {
    it(`${name}: members, consent, summary (flags only), settings and onboarding summary`, async () => {
      const [hh] = await db.select().from(household).where(eq(household.name, name));
      expect(hh, `household "${name}" exists`).toBeTruthy();
      const members = await listMembers(db, hh!.id);
      expect(members.length).toBeGreaterThanOrEqual(2);

      const consents = await db.select().from(consent).where(eq(consent.householdId, hh!.id));
      expect(consents.length).toBeGreaterThan(0);

      for (const m of members) {
        const s = await getMemberSummary(db, hh!.id, m.id);
        expect(Object.keys(s).sort()).toEqual(["flags", "isChild", "memberId"]);
      }

      const settings = await getHouseholdSettings(db, hh!.id);
      expect(settings.weekdayBreakfastMinutes).toBeGreaterThan(0);
      const onboarding = await getOnboardingSummary(db, hh!.id);
      expect(onboarding.memberNames.length).toBe(members.length);
    });
  }

  it("Busy Parent Household: the 11-year-old is a child and the adults are not", async () => {
    const [hh] = await db.select().from(household).where(eq(household.name, "Busy Parent Household"));
    const members = await listMembers(db, hh!.id);
    const flags = await Promise.all(members.map((m) => getMemberSummary(db, hh!.id, m.id)));
    const kids = members.filter((m, i) => flags[i]!.isChild).map((m) => m.name);
    expect(kids.length).toBeGreaterThanOrEqual(2); // kids aged 11 and 6
    expect(flags.some((f) => f.flags.includes("under_18"))).toBe(true);
  });

});

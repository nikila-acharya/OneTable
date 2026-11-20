/**
 * WP-1.5 — AC01 tier limits (server-side) and PV03 household erasure with a
 * DB-wide check. Live DB; test households only.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { appUser, household, verificationTokens } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { grantConsent } from "../../src/lib/consent/service";
import { createMember, listMembers } from "../../src/lib/members/service";
import { writeHealth } from "../../src/lib/health/service";
import { TierLimitError } from "../../src/lib/tier/limits";
import { setHouseholdTier } from "../../src/lib/tier/service";

const hasDb = Boolean(process.env.DATABASE_URL);
const NOW = new Date("2026-10-21T12:00:00Z");
const created: string[] = [];

const profile = (name: string) => ({ name, birthYm: "1985-04", sex: "unspecified" as const, activityLevel: "moderate" as const });

describe.skipIf(!hasDb)("WP-1.5 tiers and erasure (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  async function newHousehold(tier: "free" | "household" = "free") {
    const [hh] = await db
      .insert(household)
      .values({ name: `tier-test-${randomBytes(4).toString("hex")}`, tier, timezone: "UTC" })
      .returning();
    created.push(hh!.id);
    const email = `t-${randomBytes(6).toString("hex")}@test.invalid`;
    await db.insert(appUser).values({ householdId: hh!.id, email });
    return { householdId: hh!.id, email };
  }

  describe("AC01 household-size cap (ADR-117: free app, 10 members)", () => {
    it("a free household can save 10 members; the 11th is refused and not written", async () => {
      // Was: the 2nd member was refused. AC01's "free single member" split is
      // retired, so a normal family must be able to set up everyone at once.
      const { householdId } = await newHousehold("free");
      for (let i = 0; i < 10; i++) await createMember(db, householdId, profile(`M${i}`), NOW);
      await expect(createMember(db, householdId, profile("M10"), NOW)).rejects.toBeInstanceOf(TierLimitError);
      expect(await listMembers(db, householdId)).toHaveLength(10);
    });

    it("the household tier carries the same cap, so no tier unlocks more members", async () => {
      const { householdId } = await newHousehold("household");
      for (let i = 0; i < 10; i++) await createMember(db, householdId, profile(`M${i}`), NOW);
      await expect(createMember(db, householdId, profile("M10"), NOW)).rejects.toBeInstanceOf(TierLimitError);
      expect(await listMembers(db, householdId)).toHaveLength(10);
    });

    it("states the cap instead of pointing at an upgrade that grants nothing", async () => {
      // The old text was "your free plan includes 1 member; upgrade to add
      // more" — and upgrading now changes nothing about the cap, so that
      // instruction was a dead end for the user.
      const { householdId } = await newHousehold("free");
      for (let i = 0; i < 10; i++) await createMember(db, householdId, profile(`M${i}`), NOW);
      await expect(createMember(db, householdId, profile("M10"), NOW)).rejects.toThrow(
        /at most 10 members/,
      );
      await expect(createMember(db, householdId, profile("M10"), NOW)).rejects.not.toThrow(/upgrade/);
    });

    it("the billing stub still flips the tier (it just no longer changes the cap)", async () => {
      const { householdId } = await newHousehold("free");
      await createMember(db, householdId, profile("First"), NOW);
      await setHouseholdTier(db, householdId, "household");
      await createMember(db, householdId, profile("Second"), NOW);
      expect(await listMembers(db, householdId)).toHaveLength(2);
    });
  });

  describe("PV03 erasure is complete", () => {
    it("after deletion, no row anywhere in the database references the household, and its sign-in tokens are gone", async () => {
      const { householdId, email } = await newHousehold("household");
      const memberId = await createMember(db, householdId, profile("Erase me"), NOW);
      await grantConsent(db, householdId, "allergies");
      await grantConsent(db, householdId, "health_conditions");
      await writeHealth(db, householdId, memberId, { allergies: ["peanuts"], conditions: ["type 2 diabetes"] });
      await db.insert(verificationTokens).values({
        identifier: email,
        token: `tok-${randomBytes(8).toString("hex")}`,
        expires: new Date(Date.now() + 3600_000),
      });

      // Sanity: the household's data is really there before erasure.
      const before = await countReferences(db, householdId);
      expect(before).toBeGreaterThan(3);

      await eraseHousehold(db, householdId);
      created.splice(created.indexOf(householdId), 1);

      expect(await countReferences(db, householdId)).toBe(0);
      const tokens = await db.select().from(verificationTokens).where(sql`identifier = ${email}`);
      expect(tokens).toHaveLength(0);
    });
  });
});

/** Counts rows in every public table whose full text (all columns) contains the id. */
async function countReferences(db: Db, householdId: string): Promise<number> {
  if (!/^[0-9a-f-]{36}$/i.test(householdId)) throw new Error("bad id");
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`,
  );
  let total = 0;
  for (const row of tables) {
    const name = String((row as { table_name: string }).table_name);
    const r = await db.execute(
      sql.raw(`select count(*)::int as n from "${name}" where row_to_json("${name}")::text like '%${householdId}%'`),
    );
    total += Number((r[0] as { n: number }).n);
  }
  return total;
}

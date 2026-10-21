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

  describe("AC01 member limits (enforced on the server)", () => {
    it("a free household has one member; the second add is refused and nothing is saved", async () => {
      const { householdId } = await newHousehold("free");
      await createMember(db, householdId, profile("First"), NOW);
      await expect(createMember(db, householdId, profile("Second"), NOW)).rejects.toBeInstanceOf(TierLimitError);
      expect(await listMembers(db, householdId)).toHaveLength(1);
    });

    it("a household plan allows up to 8 members; the 9th is refused", async () => {
      const { householdId } = await newHousehold("household");
      for (let i = 0; i < 8; i++) await createMember(db, householdId, profile(`M${i}`), NOW);
      await expect(createMember(db, householdId, profile("M8"), NOW)).rejects.toBeInstanceOf(TierLimitError);
      expect(await listMembers(db, householdId)).toHaveLength(8);
    });

    it("the billing stub upgrades a household, and the next add is allowed", async () => {
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

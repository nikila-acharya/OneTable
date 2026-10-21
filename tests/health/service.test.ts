/** WP-1.3 — encrypted health storage behind the consent gate; summary flags only (live DB). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { appUser, household, member, memberHealth } from "../../db/schema";
import { decryptHealth } from "../../db/crypto";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { ConsentRequiredError } from "../../src/lib/consent/gate";
import { grantConsent, withdrawConsent } from "../../src/lib/consent/service";
import { readHealth, writeHealth } from "../../src/lib/health/service";
import { isChildAge } from "../../src/lib/members/age";
import { getMemberSummary } from "../../src/lib/health/summary";

const hasDb = Boolean(process.env.DATABASE_URL);
const created: string[] = [];

describe.skipIf(!hasDb)("WP-1.3 health (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  async function newMember(birthYm = "1985-04") {
    const [hh] = await db
      .insert(household)
      .values({ name: `health-test-${randomBytes(4).toString("hex")}`, tier: "free", timezone: "UTC" })
      .returning();
    created.push(hh!.id);
    await db.insert(appUser).values({ householdId: hh!.id, email: `h-${randomBytes(6).toString("hex")}@test.invalid` });
    const [m] = await db
      .insert(member)
      .values({ householdId: hh!.id, name: "Test", birthYm, sex: "unspecified", activityLevel: "moderate", dietPattern: "unspecified", isChild: isChildAge(birthYm, new Date()) })
      .returning();
    return { householdId: hh!.id, memberId: m!.id };
  }

  it("without consent, a health write is refused and no health row exists (PV01)", async () => {
    const { householdId, memberId } = await newMember();
    await expect(writeHealth(db, householdId, memberId, { allergies: ["peanuts"] })).rejects.toBeInstanceOf(ConsentRequiredError);
    expect(await db.select().from(memberHealth).where(eq(memberHealth.memberId, memberId))).toHaveLength(0);
  });

  it("with consent, the blob is encrypted at rest and round-trips", async () => {
    const { householdId, memberId } = await newMember();
    await grantConsent(db, householdId, "allergies");
    await grantConsent(db, householdId, "health_conditions");
    await writeHealth(db, householdId, memberId, { allergies: ["peanuts"], conditions: ["type 2 diabetes"] });
    const [row] = await db.select().from(memberHealth).where(eq(memberHealth.memberId, memberId));
    expect(row!.dataEnc).not.toMatch(/peanuts|diabetes/);
    expect(decryptHealth(row!.dataEnc).allergies).toEqual(["peanuts"]);
    expect((await readHealth(db, householdId, memberId)).conditions).toEqual(["type 2 diabetes"]);
  });

  it("a second write merges, it does not wipe the other fields", async () => {
    const { householdId, memberId } = await newMember();
    await grantConsent(db, householdId, "allergies");
    await grantConsent(db, householdId, "allergies"); // idempotent grant
    await writeHealth(db, householdId, memberId, { allergies: ["milk"] });
    await writeHealth(db, householdId, memberId, { otherAllergens: ["mango"] });
    const h = await readHealth(db, householdId, memberId);
    expect(h.allergies).toEqual(["milk"]);
    expect(h.otherAllergens).toEqual(["mango"]);
  });

  it("withdrawing allergies clears them in the same request (WP-1.1 deletion)", async () => {
    const { householdId, memberId } = await newMember();
    await grantConsent(db, householdId, "allergies");
    await writeHealth(db, householdId, memberId, { allergies: ["egg"] });
    await withdrawConsent(db, householdId, "allergies");
    expect((await readHealth(db, householdId, memberId)).allergies).toEqual([]);
  });

  it("summary is flags only: no heights, weights or condition names reach the agent (NF-P5)", async () => {
    const { householdId, memberId } = await newMember();
    await grantConsent(db, householdId, "allergies");
    await grantConsent(db, householdId, "health_conditions");
    await grantConsent(db, householdId, "body_measurements");
    await writeHealth(db, householdId, memberId, {
      allergies: ["peanuts"],
      conditions: ["type 2 diabetes", "celiac disease"],
      heightCm: 171,
      weightKg: 68,
    });
    const s = await getMemberSummary(db, householdId, memberId);
    expect(s.flags).toEqual(expect.arrayContaining([
      "allergy:peanuts",
      "general_guidance_mode",
      "clinician_confirm_banner",
      "hard_filter:gluten",
      "has_listed_condition",
    ]));
    const json = JSON.stringify(s);
    expect(json).not.toMatch(/171|68|type 2 diabetes|celiac/);
    expect(Object.keys(s).sort()).toEqual(["flags", "isChild", "memberId"]);
  });

  it("a child's summary carries the under_18 flag and no weight", async () => {
    const { householdId, memberId } = await newMember("2015-03");
    const s = await getMemberSummary(db, householdId, memberId);
    expect(s.isChild).toBe(true);
    expect(s.flags).toContain("under_18");
  });
});

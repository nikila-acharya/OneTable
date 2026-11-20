/** WP-1.6 — a finished onboarding draft lands in the backend (live DB). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { household, member } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { completeOnboarding, OnboardingRejectedError } from "../../src/lib/onboarding/complete";
import { readHealth } from "../../src/lib/health/service";
import { newDraft, newMember, type OnboardingDraft } from "../../src/app/onboarding/store";

const hasDb = Boolean(process.env.DATABASE_URL);
const NOW = new Date("2026-10-21T12:00:00Z");
const created: string[] = [];

function draft(over: Partial<OnboardingDraft> = {}, members = [] as ReturnType<typeof newMember>[]): OnboardingDraft {
  const d = newDraft();
  d.household = { ...d.household, name: "The Testers", timezone: "UTC" };
  d.members = members;
  return { ...d, ...over };
}

function adult(name: string, over: Partial<ReturnType<typeof newMember>> = {}) {
  return {
    ...newMember(),
    name,
    birthYear: 1985,
    birthMonth: 4,
    sex: "prefer-not" as const,
    activity: "low-active" as const,
    dietaryPattern: "other" as const,
    ...over,
  };
}

describe.skipIf(!hasDb)("WP-1.6 onboarding completion (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  async function newHousehold(tier: "free" | "household") {
    const [hh] = await db.insert(household).values({ name: "t", tier, timezone: "UTC" }).returning();
    created.push(hh!.id);
    return hh!.id;
  }

  it("a complete draft writes household, members, consent-gated health and attendance", async () => {
    const hid = await newHousehold("household");
    const m = adult("Ana", {
      allergies: ["peanuts", "kiwi"],
      conditions: ["type 2 diabetes"],
      heightCm: "165",
      weightKg: "70",
      dietaryPattern: "vegetarian",
      homeFor: { breakfast: true, lunch: true, snack: false, dinner: true },
      packedLunch: "work",
    });
    const d = draft(
      {
        consent: {
          allergies: { granted: true, at: NOW.toISOString(), policyVersion: "2026-10-16" },
          conditions: { granted: true, at: NOW.toISOString(), policyVersion: "2026-10-16" },
          // no measurements consent: height and weight must be stored as nothing
        },
        meals: [{ memberId: m.id, breakfast: true, lunch: true, snack: false, secondSnack: false, dinner: true, packedLunch: "work" }],
      },
      [m],
    );
    const res = await completeOnboarding(db, hid, d, NOW);
    expect(res).toEqual({ members: 1, consents: 2 });

    const [saved] = await db.select().from(member).where(eq(member.householdId, hid));
    expect(saved!.name).toBe("Ana");
    expect(saved!.dietPattern).toBe("vegetarian");

    const health = await readHealth(db, hid, saved!.id);
    expect(health.allergies).toEqual(["peanuts"]);
    expect(health.otherAllergens).toEqual(["kiwi"]);
    expect(health.conditions).toEqual(["type 2 diabetes"]);
    expect(health.heightCm).toBeNull();
    expect(health.weightKg).toBeNull();
  });

  it("a draft that fails validation writes nothing", async () => {
    const hid = await newHousehold("household");
    const d = draft({}, [adult("")]); // empty name
    await expect(completeOnboarding(db, hid, d, NOW)).rejects.toBeInstanceOf(OnboardingRejectedError);
    expect(await db.select().from(member).where(eq(member.householdId, hid))).toHaveLength(0);
  });

  it("a free household can save a full family of 10 members", async () => {
    // AC01's free cap of 1 member is retired (ADR-117). This is the case that
    // used to dead-end at step 6 for exactly the household size PRD 3 targets.
    const hid = await newHousehold("free");
    const many = Array.from({ length: 10 }, (_, i) => adult(`Member ${i + 1}`));
    const res = await completeOnboarding(db, hid, draft({}, many), NOW);
    expect(res.members).toBe(10);
    expect(await db.select().from(member).where(eq(member.householdId, hid))).toHaveLength(10);
  });

  it("an 11th member is refused, and the message reports the COUNT not the cap", async () => {
    const hid = await newHousehold("free");
    const many = Array.from({ length: 11 }, (_, i) => adult(`Member ${i + 1}`));
    const err = await completeOnboarding(db, hid, draft({}, many), NOW).then(
      () => null,
      (e) => e,
    );
    expect(err).toBeInstanceOf(OnboardingRejectedError);
    const issues = (err as OnboardingRejectedError).issues;
    const text = issues.join(" · ");
    // The old text interpolated the cap: an 11-member draft on a 1-member cap
    // said "this plan includes 1 members" — naming the wrong number entirely.
    expect(text).toContain("11 members");
    expect(text).toContain("at most 10");
    expect(text).not.toMatch(/^this plan includes 1 members$/);
    expect(await db.select().from(member).where(eq(member.householdId, hid))).toHaveLength(0);
  });

  it("an under-13 weight is refused even with measurement consent", async () => {
    const hid = await newHousehold("household");
    const child = adult("Kid", { birthYear: 2018, birthMonth: 1, weightKg: "20", heightCm: "110" });
    const d = draft(
      { consent: { measurements: { granted: true, at: NOW.toISOString(), policyVersion: "2026-10-16" } } },
      [child],
    );
    await expect(completeOnboarding(db, hid, d, NOW)).rejects.toBeInstanceOf(OnboardingRejectedError);
    expect(await db.select().from(member).where(eq(member.householdId, hid))).toHaveLength(0);
  });
});

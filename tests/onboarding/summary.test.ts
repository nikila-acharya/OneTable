/** WP-1.6 — the Done screen reads what the server stored (live DB; session mocked for the route). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../../db/index";
import { household } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { completeOnboarding } from "../../src/lib/onboarding/complete";
import { getOnboardingSummary } from "../../src/lib/onboarding/summary";
import { newDraft, newMember } from "../../src/app/onboarding/store";

const session = vi.hoisted(() => ({ householdId: null as string | null }));
vi.mock("@/lib/auth", () => {
  class AuthenticationError extends Error {
    readonly status = 401;
  }
  return {
    AuthenticationError,
    requireUser: async () => {
      if (!session.householdId) throw new AuthenticationError("not signed in");
      return { userId: "u", email: "x@x.invalid", householdId: session.householdId };
    },
  };
});

const hasDb = Boolean(process.env.DATABASE_URL);
const created: string[] = [];

describe.skipIf(!hasDb)("WP-1.6 onboarding summary (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
    session.householdId = null;
  });

  it("returns what was stored: household name, member names and settings", async () => {
    const [hh] = await db.insert(household).values({ name: "placeholder", tier: "household", timezone: "UTC" }).returning();
    created.push(hh!.id);
    const d = newDraft();
    d.household = { ...d.household, name: "The Summary Family", timezone: "UTC", weeknightDinnerMinutes: 40, cuisines: ["Greek"] };
    d.members = [{ ...newMember(), name: "Lea", birthYear: 1980, birthMonth: 1, sex: "prefer-not", activity: "active", dietaryPattern: "omnivore" }];
    await completeOnboarding(db, hh!.id, d, new Date("2026-10-21T12:00:00Z"));
    const s = await getOnboardingSummary(db, hh!.id);
    expect(s.householdName).toBe("The Summary Family");
    expect(s.memberNames).toEqual(["Lea"]);
    expect(s.settings.weeknightDinnerMinutes).toBe(40);
    expect(s.settings.cuisines).toEqual(["Greek"]);
  });

  it("the route returns 401 without a session and the summary with one", async () => {
    const { GET } = await import("../../src/app/api/onboarding/summary/route");
    session.householdId = null;
    expect((await GET()).status).toBe(401);
    const [hh] = await db.insert(household).values({ name: "route", tier: "free", timezone: "UTC" }).returning();
    created.push(hh!.id);
    session.householdId = hh!.id;
    const ok = await GET();
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { householdName: string; memberNames: string[] };
    expect(body.householdName).toBe("route");
    expect(body.memberNames).toEqual([]);
  });
});

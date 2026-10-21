/** WP-1.6 sign-up and the onboarding submit route (live DB; session mocked). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { appUser, household, member } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { signUpHousehold, EmailTakenError, SignupRejectedError, MIN_PASSWORD_CHARS } from "../../src/lib/signup/service";
import { newDraft, newMember, type OnboardingDraft } from "../../src/app/onboarding/store";

const hasDb = Boolean(process.env.DATABASE_URL);

// The route's session guard: each test sets who (if anyone) is signed in.
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

const created: string[] = [];
const uniqueEmail = () => `signup-${randomBytes(6).toString("hex")}@test.invalid`;
const PASSWORD = "correct-horse-battery"; // test-only; never logged

describe.skipIf(!hasDb)("WP-1.6 sign-up (live DB)", () => {
  let db: Db;
  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  it("creates a household and its one user; the password is stored only as a hash", async () => {
    const email = uniqueEmail();
    const { householdId, userId } = await signUpHousehold(db, { email, password: PASSWORD, householdName: "The Signups" });
    created.push(householdId);
    const [u] = await db.select().from(appUser).where(eq(appUser.id, userId));
    expect(u!.householdId).toBe(householdId);
    expect(u!.passwordHash?.startsWith("scrypt$")).toBe(true);
    expect(u!.passwordHash).not.toContain(PASSWORD);
    const [hh] = await db.select().from(household).where(eq(household.id, householdId));
    expect(hh!.tier).toBe("free");
    expect(hh!.name).toBe("The Signups");
  });

  it("a second sign-up with the same email is refused and creates nothing", async () => {
    const email = uniqueEmail();
    const first = await signUpHousehold(db, { email, password: PASSWORD });
    created.push(first.householdId);
    await expect(signUpHousehold(db, { email: email.toUpperCase(), password: PASSWORD })).rejects.toBeInstanceOf(EmailTakenError);
    const users = await db.select().from(appUser).where(eq(appUser.email, email));
    expect(users).toHaveLength(1);
  });

  it("a short password or bad email is refused with issues and nothing is created", async () => {
    await expect(signUpHousehold(db, { email: "not-an-email", password: "x".repeat(MIN_PASSWORD_CHARS - 1) })).rejects.toBeInstanceOf(SignupRejectedError);
    const before = await db.select({ id: household.id }).from(household);
    await expect(signUpHousehold(db, { email: uniqueEmail(), password: "short" })).rejects.toBeInstanceOf(SignupRejectedError);
    expect(await db.select({ id: household.id }).from(household)).toHaveLength(before.length);
  });
});

describe.skipIf(!hasDb)("WP-1.6 onboarding submit route (live DB)", () => {
  let db: Db;
  let householdId: string;
  beforeAll(async () => {
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
    const { householdId: hid } = await signUpHousehold(db, { email: uniqueEmail(), password: PASSWORD });
    householdId = hid;
    created.push(hid);
  });
  afterAll(async () => {
    session.householdId = null;
  });

  function draftWith(name: string): OnboardingDraft {
    const d = newDraft();
    d.household = { ...d.household, name: "Route test", timezone: "UTC" };
    const m = { ...newMember(), name, birthYear: 1985, birthMonth: 4, sex: "prefer-not" as const, activity: "active" as const, dietaryPattern: "omnivore" as const };
    d.members = [m];
    d.meals = [];
    return d;
  }

  it("without a session: 401 and nothing is written", async () => {
    session.householdId = null;
    const { POST } = await import("../../src/app/api/onboarding/complete/route");
    const res = await POST(new Request("http://t/api/onboarding/complete", { method: "POST", body: JSON.stringify(draftWith("Ghost")) }));
    expect(res.status).toBe(401);
    expect(await db.select().from(member).where(eq(member.householdId, householdId))).toHaveLength(0);
  });

  it("a refused draft: 422 with issues and nothing is written", async () => {
    session.householdId = householdId;
    const { POST } = await import("../../src/app/api/onboarding/complete/route");
    const res = await POST(new Request("http://t/api/onboarding/complete", { method: "POST", body: JSON.stringify(draftWith("")) }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string; issues: string[] };
    expect(body.error).toBe("onboarding_rejected");
    expect(body.issues.length).toBeGreaterThan(0);
    expect(await db.select().from(member).where(eq(member.householdId, householdId))).toHaveLength(0);
  });

  it("a valid draft with a session: 201 and the member is saved", async () => {
    session.householdId = householdId;
    const { POST } = await import("../../src/app/api/onboarding/complete/route");
    const res = await POST(new Request("http://t/api/onboarding/complete", { method: "POST", body: JSON.stringify(draftWith("Route Ana")) }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ members: 1, consents: 0 });
    const rows = await db.select().from(member).where(eq(member.householdId, householdId));
    expect(rows.map((r) => r.name)).toEqual(["Route Ana"]);
  });

  it("a body that is not a draft: 400", async () => {
    session.householdId = householdId;
    const { POST } = await import("../../src/app/api/onboarding/complete/route");
    const res = await POST(new Request("http://t/api/onboarding/complete", { method: "POST", body: JSON.stringify({ hello: 1 }) }));
    expect(res.status).toBe(400);
  });
});

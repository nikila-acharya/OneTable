/**
 * WP-1.1 — PV01 consent, NF-P3 append-only log, withdraw-deletes-in-request.
 * Runs against the live Postgres (DATABASE_URL: Neon dev locally, the CI
 * service container in GitHub Actions). Test households only (PRD 13.1).
 */
import { randomBytes } from "node:crypto";
import { eq, sql as ds } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { openDb, type Db } from "../../db/index";
import {
  activityCheckin,
  activityGoal,
  appUser,
  consent,
  household,
  member,
  memberHealth,
} from "../../db/schema";
import { decryptHealth, encryptHealth } from "../../db/crypto";
import { ConsentRequiredError, guardProfileWrite, assertAgentRunAllowed } from "../../src/lib/consent/gate";
import { effectiveStates } from "../../src/lib/consent/store";
import { grantConsent, withdrawConsent } from "../../src/lib/consent/service";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { CONSENT_DATA_TYPES } from "../../src/lib/consent/types";
import { DEFAULT_POLICY_VERSION } from "../../src/lib/consent/policy";

const hasDb = Boolean(process.env.DATABASE_URL);

/** Drizzle wraps driver errors ("Failed query: ..."); the Postgres text is in cause. */
async function expectAppendOnlyRefusal(p: Promise<unknown>): Promise<void> {
  const err = await p.then(() => null, (e: unknown) => e);
  expect(err).not.toBeNull();
  const e = err as { message?: string; cause?: { message?: string } };
  expect(`${e.message ?? ""} ${e.cause?.message ?? ""}`).toMatch(/append-only/);
}
const created: string[] = [];

async function newHousehold(db: Db) {
  const [hh] = await db
    .insert(household)
    .values({ name: `consent-test-${randomBytes(4).toString("hex")}`, tier: "free", timezone: "UTC" })
    .returning();
  created.push(hh!.id);
  await db.insert(appUser).values({
    householdId: hh!.id,
    email: `consent-${randomBytes(6).toString("hex")}@test.invalid`,
  });
  return hh!.id;
}

async function newMember(db: Db, householdId: string) {
  const [m] = await db
    .insert(member)
    .values({
      householdId,
      name: "Test Member",
      birthYm: "1990-01",
      sex: "unspecified",
      activityLevel: "moderate",
      dietPattern: "unspecified",
      isChild: false,
    })
    .returning();
  return m!.id;
}

describe.skipIf(!hasDb)("WP-1.1 consent (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    // Health blobs need ENCRYPTION_KEY. CI's unit job does not set one, so the
    // test process gets a throwaway random key (not a secret; app config unchanged).
    if (!process.env.ENCRYPTION_KEY) process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  it("the TS data-type list equals the Postgres enum (no drift)", async () => {
    const rows = await db.execute(
      ds`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'consent_data_type' order by e.enumsortorder`,
    );
    expect(rows.map((r) => r.enumlabel)).toEqual([...CONSENT_DATA_TYPES]);
  });

  it("no consent: the gated write is refused and stores nothing (PV01 AC)", async () => {
    const hh = await newHousehold(db);
    const m = await newMember(db, hh);
    await expect(guardProfileWrite(db, hh, { conditions: ["asthma"] })).rejects.toBeInstanceOf(ConsentRequiredError);
    const rows = await db.select().from(memberHealth).where(eq(memberHealth.memberId, m));
    expect(rows).toHaveLength(0);
  });

  it("after grant, the same gated write passes", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "health_conditions");
    await expect(guardProfileWrite(db, hh, { conditions: ["asthma"] })).resolves.toBeUndefined();
  });

  it("a write touching two data types needs both consents", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "allergies");
    const err = await guardProfileWrite(db, hh, { allergies: ["peanuts"], heightCm: 170 }).catch((e) => e);
    expect(err).toBeInstanceOf(ConsentRequiredError);
    expect((err as ConsentRequiredError).dataTypes).toEqual(["body_measurements"]);
  });

  it("grant -> withdraw -> re-grant under the same policy version is storable (append-only, no unique key)", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "allergies");
    await withdrawConsent(db, hh, "allergies");
    await grantConsent(db, hh, "allergies");
    const allergies = (await effectiveStates(db, hh)).find((s) => s.dataType === "allergies");
    expect(allergies?.granted).toBe(true);
  });

  it("policy bump: an earlier grant becomes requires_reconsent and stops passing the gate", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "agent_processing");
    const bumped = await effectiveStates(db, hh, "2099-01-01");
    const agent = bumped.find((s) => s.dataType === "agent_processing")!;
    expect(agent.granted).toBe(false);
    expect(agent.requiresReconsent).toBe(true);
    expect(agent.policyVersion).toBe(DEFAULT_POLICY_VERSION);
  });

  it("NF-P3: UPDATE on consent is refused even inside the erasure seam", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "activity_data");
    await expectAppendOnlyRefusal(db.update(consent).set({ granted: false }).where(eq(consent.householdId, hh)));
  });

  it("NF-P3: DELETE on consent is refused outside the erasure seam", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "activity_data");
    await expectAppendOnlyRefusal(db.delete(consent).where(eq(consent.householdId, hh)));
  });

  it("withdraw body_measurements clears height and weight in the same request", async () => {
    const hh = await newHousehold(db);
    const m = await newMember(db, hh);
    await grantConsent(db, hh, "body_measurements");
    await db.insert(memberHealth).values({
      memberId: m,
      dataEnc: encryptHealth({ heightCm: 170, weightKg: 70, conditions: [], allergies: [], otherAllergens: [] }),
    });
    await withdrawConsent(db, hh, "body_measurements");
    const [row] = await db.select().from(memberHealth).where(eq(memberHealth.memberId, m));
    const data = decryptHealth(row!.dataEnc);
    expect(data.heightCm).toBeNull();
    expect(data.weightKg).toBeNull();
  });

  it("withdraw activity_data removes check-ins and goals", async () => {
    const hh = await newHousehold(db);
    const m = await newMember(db, hh);
    await grantConsent(db, hh, "activity_data");
    await db.insert(activityCheckin).values({ memberId: m, weekStart: "2026-10-12", status: "done" });
    await db.insert(activityGoal).values({ memberId: m, weekStart: "2026-10-12", targetSessions: 3 });
    await withdrawConsent(db, hh, "activity_data");
    expect(await db.select().from(activityCheckin).where(eq(activityCheckin.memberId, m))).toHaveLength(0);
    expect(await db.select().from(activityGoal).where(eq(activityGoal.memberId, m))).toHaveLength(0);
  });

  it("withdrawing agent_processing blocks agent runs", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "agent_processing");
    await expect(assertAgentRunAllowed(db, hh)).resolves.toBeUndefined();
    await withdrawConsent(db, hh, "agent_processing");
    await expect(assertAgentRunAllowed(db, hh)).rejects.toBeInstanceOf(ConsentRequiredError);
  });

  it("erasure removes the household's consent rows (PV03, consent table)", async () => {
    const hh = await newHousehold(db);
    await grantConsent(db, hh, "allergies");
    await eraseHousehold(db, hh);
    created.splice(created.indexOf(hh), 1);
    const left = await db.select().from(consent).where(eq(consent.householdId, hh));
    expect(left).toHaveLength(0);
  });
});

describe("consent API (auth and validation, no DB writes on bad input)", () => {
  vi.mock("@/lib/auth", () => {
    class AuthenticationError extends Error {}
    return {
      AuthenticationError,
      requireUser: vi.fn(async () => {
        throw new AuthenticationError("not signed in");
      }),
    };
  });

  it("POST without a session is 401", async () => {
    const { POST } = await import("../../src/app/api/consent/route");
    const res = await POST(
      new Request("http://test/api/consent", {
        method: "POST",
        body: JSON.stringify({ dataType: "allergies", granted: true }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("POST with an unknown data type is 400 (validated before auth)", async () => {
    const { POST } = await import("../../src/app/api/consent/route");
    const res = await POST(
      new Request("http://test/api/consent", {
        method: "POST",
        body: JSON.stringify({ dataType: "weight_loss_goal", granted: true }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

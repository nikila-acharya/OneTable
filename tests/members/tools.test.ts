/**
 * WP-1.2 — the setup agent's P-level member tools through the real registry
 * (propose -> approve -> apply). Live DB for the membership checks.
 */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { openDb, type Db } from "../../db/index";
import { appUser, household, member } from "../../db/schema";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { registerMemberTools } from "../../src/lib/members/tools";
import { ToolRegistry } from "../../agent/tools/registry";
import { InMemoryApprovalStore } from "../../agent/tools/approvals";
import { InMemoryActionLog } from "../../agent/tools/action-log";
import { memberToolImplementations } from "../../src/lib/members/tools";

const hasDb = Boolean(process.env.DATABASE_URL);
const NOW = new Date("2026-10-20T12:00:00Z");
const created: string[] = [];

/** The household approves in the UI; in tests the store stands in for that step. */
async function approve(store: InMemoryApprovalStore, approvalId: string) {
  await store.setStatus(approvalId, "approved", NOW.toISOString());
}

function makeRegistry(db: Db, store: InMemoryApprovalStore) {
  const registry = new ToolRegistry({
    approvals: store,
    actionLog: new InMemoryActionLog(),
    now: () => NOW,
  });
  registerMemberTools(registry, db, () => NOW);
  return registry;
}

describe("member tool levels", () => {
  it("both member tools are P-level (PRD 7.2)", () => {
    const tools = memberToolImplementations({} as Db, () => NOW);
    expect(tools.map((t) => [t.name, t.level])).toEqual([
      ["create_or_update_member", "P"],
      ["set_attendance", "P"],
    ]);
  });
});

describe.skipIf(!hasDb)("member tools via the registry (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  async function newHousehold(): Promise<string> {
    const [hh] = await db
      .insert(household)
      .values({ name: `tools-test-${randomBytes(4).toString("hex")}`, tier: "free", timezone: "UTC" })
      .returning();
    created.push(hh!.id);
    await db.insert(appUser).values({ householdId: hh!.id, email: `t-${randomBytes(6).toString("hex")}@test.invalid` });
    return hh!.id;
  }

  const input = { name: "Lily", birthYm: "2015-02", sex: "female", activityLevel: "light" };

  it("propose saves nothing; approve then apply saves the member", async () => {
    const hh = await newHousehold();
    const store = new InMemoryApprovalStore();
    const registry = makeRegistry(db, store);
    const ctx = { runId: "run-1", householdId: hh };

    const proposed = await registry.call("setup", "create_or_update_member", input, ctx);
    expect(proposed.ok && proposed.outcome).toBe("approval_requested");
    const rows0 = await db.select().from(member).where(eq(member.householdId, hh));
    expect(rows0).toHaveLength(0);

    const approvalId = (proposed as { approvalId: string }).approvalId;
    await approve(store, approvalId);
    const applied = await registry.call("setup", "create_or_update_member", { ...input, approvalId }, ctx);
    expect(applied.ok && applied.outcome).toBe("executed");
    const rows1 = await db.select().from(member).where(eq(member.householdId, hh));
    expect(rows1).toHaveLength(1);
    expect(rows1[0]!.isChild).toBe(true);
  });

  it("an approval cannot be replayed with a changed payload", async () => {
    const hh = await newHousehold();
    const store = new InMemoryApprovalStore();
    const registry = makeRegistry(db, store);
    const ctx = { runId: "run-2", householdId: hh };
    const proposed = await registry.call("setup", "create_or_update_member", input, ctx);
    const approvalId = (proposed as { approvalId: string }).approvalId;
    await approve(store, approvalId);
    const tampered = await registry.call(
      "setup",
      "create_or_update_member",
      { ...input, name: "Someone else", approvalId },
      ctx,
    );
    expect(tampered.ok).toBe(false);
    expect(!tampered.ok && tampered.error).toBe("approval_payload_mismatch");
    expect(await db.select().from(member).where(eq(member.householdId, hh))).toHaveLength(0);
  });

  it("a credential or health field is refused at the schema, before any approval is created", async () => {
    const hh = await newHousehold();
    const store = new InMemoryApprovalStore();
    const registry = makeRegistry(db, store);
    const ctx = { runId: "run-3", householdId: hh };
    const withEmail = await registry.call("setup", "create_or_update_member", { ...input, email: "x@y.z" }, ctx);
    expect(!withEmail.ok && withEmail.error).toBe("invalid_input");
    const withAllergy = await registry.call("setup", "create_or_update_member", { ...input, allergies: ["peanuts"] }, ctx);
    expect(!withAllergy.ok && withAllergy.error).toBe("invalid_input");
    expect(await db.select().from(member).where(eq(member.householdId, hh))).toHaveLength(0);
  });
});

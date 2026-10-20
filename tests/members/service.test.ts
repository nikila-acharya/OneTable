/** WP-1.2 — member CRUD, attendance, household isolation (live DB). */
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openDb, type Db } from "../../db/index";
import { appUser, household, memberAttendance } from "../../db/schema";
import { eq } from "drizzle-orm";
import { eraseHousehold } from "../../src/lib/consent/erase";
import { createMember, getMember, listMembers, setAttendance, updateMember } from "../../src/lib/members/service";
import { MemberError } from "../../src/lib/members/types";

const hasDb = Boolean(process.env.DATABASE_URL);
const created: string[] = [];
const NOW = new Date("2026-10-20T12:00:00Z");

async function newHousehold(db: Db): Promise<string> {
  const [hh] = await db
    .insert(household)
    .values({ name: `members-test-${randomBytes(4).toString("hex")}`, tier: "free", timezone: "UTC" })
    .returning();
  created.push(hh!.id);
  await db.insert(appUser).values({ householdId: hh!.id, email: `m-${randomBytes(6).toString("hex")}@test.invalid` });
  return hh!.id;
}

describe.skipIf(!hasDb)("WP-1.2 member profiles (live DB)", () => {
  let db: Db;
  beforeAll(() => {
    db = openDb().db;
  });
  afterAll(async () => {
    for (const id of created) await eraseHousehold(db, id);
  });

  it("create -> read -> update round-trips profile and preferences", async () => {
    const hh = await newHousehold(db);
    const id = await createMember(db, hh, {
      name: "Sam", birthYm: "2011-03", sex: "male", activityLevel: "high" as never, likes: ["pasta"], dislikes: ["okra"],
    }, NOW);
    const p = await getMember(db, hh, id);
    expect(p.name).toBe("Sam");
    expect(p.isChild).toBe(true);
    expect(p.likes).toEqual(["pasta"]);
    expect(p.dislikes).toEqual(["okra"]);

    await updateMember(db, hh, id, { name: "Samuel", dislikes: [] }, NOW);
    const after = await getMember(db, hh, id);
    expect(after.name).toBe("Samuel");
    expect(after.dislikes).toEqual([]);
    expect(after.likes).toEqual(["pasta"]);
  });

  it("a member is a child until 18; the flag updates on the next write after the birthday", async () => {
    const hh = await newHousehold(db);
    // Born Nov 2008: still 17 on 20 Oct 2026, turns 18 on 1 Nov 2026.
    const id = await createMember(db, hh, { name: "Teen", birthYm: "2008-11", sex: "other", activityLevel: "light" as never }, NOW);
    expect((await getMember(db, hh, id)).isChild).toBe(true);
    await updateMember(db, hh, id, { name: "Teen" }, new Date("2026-11-01T00:00:00Z"));
    expect((await getMember(db, hh, id)).isChild).toBe(false);
  });

  it("another household cannot read or change a member (not_found, no data)", async () => {
    const mine = await newHousehold(db);
    const theirs = await newHousehold(db);
    const id = await createMember(db, theirs, { name: "Private", birthYm: "1990-01", sex: "female", activityLevel: "light" as never }, NOW);
    await expect(getMember(db, mine, id)).rejects.toBeInstanceOf(MemberError);
    await expect(updateMember(db, mine, id, { name: "Hacked" }, NOW)).rejects.toBeInstanceOf(MemberError);
    await expect(setAttendance(db, mine, id, [])).rejects.toBeInstanceOf(MemberError);
    expect((await listMembers(db, mine))).toHaveLength(0);
    expect((await getMember(db, theirs, id)).name).toBe("Private");
  });

  it("attendance upserts per (member, meal, weekday) and honours 'not home for lunch'", async () => {
    const hh = await newHousehold(db);
    const id = await createMember(db, hh, { name: "Dad", birthYm: "1980-05", sex: "male", activityLevel: "moderate" as never }, NOW);
    await setAttendance(db, hh, id, [{ mealType: "lunch", weekday: 1, attending: false, packed: false }]);
    await setAttendance(db, hh, id, [{ mealType: "lunch", weekday: 1, attending: false, packed: true }]);
    const rows = await db.select().from(memberAttendance).where(eq(memberAttendance.memberId, id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.attending).toBe(false);
    expect(rows[0]!.packed).toBe(true);
  });
});

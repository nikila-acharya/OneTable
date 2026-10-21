/**
 * Member profile persistence (WP-1.2). Every function takes the household id
 * and refuses rows that belong to another household (cross-household reads
 * and writes come back as not_found, never as data).
 */
import { and, eq, inArray } from "drizzle-orm";
import { member, memberAttendance, memberPref } from "../../../db/schema";
import type { Db } from "../db";
import { isChildAge } from "./age";
import { assertMemberCapacity } from "../tier/service";
import type { NormalizedProfile } from "./validation";
import { MemberError, type MemberProfile } from "./types";

export interface AttendanceEntry {
  mealType: "breakfast" | "lunch" | "snack" | "dinner";
  weekday: number;
  attending: boolean;
  packed: boolean;
}

async function loadProfiles(db: Db, householdId: string, ids?: string[]): Promise<MemberProfile[]> {
  const rows = await db
    .select()
    .from(member)
    .where(
      ids
        ? and(eq(member.householdId, householdId), inArray(member.id, ids))
        : eq(member.householdId, householdId),
    );
  if (rows.length === 0) return [];
  const prefs = await db
    .select()
    .from(memberPref)
    .where(inArray(memberPref.memberId, rows.map((r) => r.id)));
  return rows.map((r) => ({
    id: r.id,
    householdId: r.householdId,
    name: r.name,
    birthYm: r.birthYm,
    sex: r.sex,
    activityLevel: r.activityLevel,
    dietPattern: r.dietPattern,
    isChild: r.isChild,
    likes: prefs.filter((p) => p.memberId === r.id && p.kind === "like").map((p) => p.item).sort(),
    dislikes: prefs.filter((p) => p.memberId === r.id && p.kind === "dislike").map((p) => p.item).sort(),
  }));
}

export async function listMembers(db: Db, householdId: string): Promise<MemberProfile[]> {
  return loadProfiles(db, householdId);
}

export async function getMember(db: Db, householdId: string, memberId: string): Promise<MemberProfile> {
  const [p] = await loadProfiles(db, householdId, [memberId]);
  if (!p) throw new MemberError("not_found", "member not found");
  return p;
}

async function writePrefs(db: Db, memberId: string, kind: "like" | "dislike", items: string[]) {
  await db.delete(memberPref).where(and(eq(memberPref.memberId, memberId), eq(memberPref.kind, kind)));
  if (items.length > 0) {
    await db.insert(memberPref).values(items.map((item) => ({ memberId, kind, item, source: "profile" })));
  }
}

export async function createMember(
  db: Db,
  householdId: string,
  p: Required<Pick<NormalizedProfile, "name" | "birthYm" | "sex" | "activityLevel">> & NormalizedProfile,
  now: Date,
): Promise<string> {
  return db.transaction(async (tx) => {
    await assertMemberCapacity(tx, householdId);
    const [row] = await tx
      .insert(member)
      .values({
        householdId,
        name: p.name,
        birthYm: p.birthYm,
        sex: p.sex,
        activityLevel: p.activityLevel,
        dietPattern: p.dietPattern ?? "unspecified",
        isChild: isChildAge(p.birthYm, now),
      })
      .returning({ id: member.id });
    const id = row!.id;
    if (p.likes?.length) await writePrefs(tx, id, "like", p.likes);
    if (p.dislikes?.length) await writePrefs(tx, id, "dislike", p.dislikes);
    return id;
  });
}

export async function updateMember(
  db: Db,
  householdId: string,
  memberId: string,
  p: NormalizedProfile,
  now: Date,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(member)
      .where(and(eq(member.id, memberId), eq(member.householdId, householdId)));
    if (!existing) throw new MemberError("not_found", "member not found");
    const birthYm = p.birthYm ?? existing.birthYm;
    const patch: Partial<typeof member.$inferInsert> = {};
    if (p.name !== undefined) patch.name = p.name;
    if (p.birthYm !== undefined) patch.birthYm = p.birthYm;
    if (p.sex !== undefined) patch.sex = p.sex;
    if (p.activityLevel !== undefined) patch.activityLevel = p.activityLevel;
    if (p.dietPattern !== undefined) patch.dietPattern = p.dietPattern;
    patch.isChild = isChildAge(birthYm, now);
    if (Object.keys(patch).length > 0) {
      await tx.update(member).set(patch).where(eq(member.id, memberId));
    }
    if (p.likes !== undefined) await writePrefs(tx, memberId, "like", p.likes);
    if (p.dislikes !== undefined) await writePrefs(tx, memberId, "dislike", p.dislikes);
  });
}

export async function setAttendance(
  db: Db,
  householdId: string,
  memberId: string,
  entries: AttendanceEntry[],
): Promise<void> {
  const [owned] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.id, memberId), eq(member.householdId, householdId)));
  if (!owned) throw new MemberError("not_found", "member not found");
  await db.transaction(async (tx) => {
    for (const e of entries) {
      await tx
        .insert(memberAttendance)
        .values({ memberId, mealType: e.mealType, weekday: e.weekday, attending: e.attending, packed: e.packed })
        .onConflictDoUpdate({
          target: [memberAttendance.memberId, memberAttendance.mealType, memberAttendance.weekday],
          set: { attending: e.attending, packed: e.packed },
        });
    }
  });
}


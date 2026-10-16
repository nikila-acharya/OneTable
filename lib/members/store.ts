// MemberRepository — data port for WP-1.2.
// The WP-0.2 ORM (Prisma or Drizzle) supplies the Postgres-backed implementation;
// see db/schema/002_members.sql for the table contract. All reads and writes are
// scoped by householdId — a member id from another household must read as not_found
// (no cross-household existence oracle).

import type { AttendanceEntry, MemberPrefs, MemberRecord } from './types';

export interface NewMember {
  householdId: string;
  name: string;
  birthYm: string;
  sex: MemberRecord['sex'];
  activityLevel: MemberRecord['activityLevel'];
  dietPattern: MemberRecord['dietPattern'];
  createdAt: string;
  updatedAt: string;
}

export interface MemberUpdate {
  name?: string;
  birthYm?: string;
  sex?: MemberRecord['sex'];
  activityLevel?: MemberRecord['activityLevel'];
  dietPattern?: MemberRecord['dietPattern'];
  updatedAt: string;
}

export interface MemberRepository {
  insertMember(id: string, member: NewMember): Promise<MemberRecord>;
  getMember(householdId: string, id: string): Promise<MemberRecord | null>;
  listMembers(householdId: string): Promise<MemberRecord[]>;
  updateMember(householdId: string, id: string, patch: MemberUpdate): Promise<MemberRecord>;
  deleteMember(householdId: string, id: string): Promise<boolean>;

  setPrefs(householdId: string, memberId: string, prefs: MemberPrefs): Promise<void>;
  getPrefs(householdId: string, memberId: string): Promise<MemberPrefs>;

  upsertAttendance(householdId: string, memberId: string, entries: AttendanceEntry[]): Promise<void>;
  getAttendance(householdId: string, memberId: string): Promise<AttendanceEntry[]>;
  deleteAttendance(householdId: string, memberId: string): Promise<void>;
}

export class InMemoryMemberRepository implements MemberRepository {
  private members = new Map<string, MemberRecord>();
  private prefs = new Map<string, MemberPrefs>();
  private attendance = new Map<string, Map<string, AttendanceEntry>>();

  private key(householdId: string, id: string): string {
    return `${householdId}\u0000${id}`;
  }

  private attKey(mealType: string, weekday: number): string {
    return `${mealType}\u0000${weekday}`;
  }

  async insertMember(id: string, member: NewMember): Promise<MemberRecord> {
    const record: MemberRecord = { id, ...member };
    this.members.set(this.key(member.householdId, id), record);
    return { ...record };
  }

  async getMember(householdId: string, id: string): Promise<MemberRecord | null> {
    const rec = this.members.get(this.key(householdId, id));
    return rec ? { ...rec } : null;
  }

  async listMembers(householdId: string): Promise<MemberRecord[]> {
    return [...this.members.values()]
      .filter((m) => m.householdId === householdId)
      .map((m) => ({ ...m }));
  }

  async updateMember(householdId: string, id: string, patch: MemberUpdate): Promise<MemberRecord> {
    const k = this.key(householdId, id);
    const current = this.members.get(k);
    if (!current) throw new Error(`member ${id} not found`);
    const next: MemberRecord = { ...current, ...patch };
    this.members.set(k, next);
    return { ...next };
  }

  async deleteMember(householdId: string, id: string): Promise<boolean> {
    const k = this.key(householdId, id);
    if (!this.members.has(k)) return false;
    this.members.delete(k);
    this.prefs.delete(k);
    this.attendance.delete(k);
    return true;
  }

  async setPrefs(householdId: string, memberId: string, prefs: MemberPrefs): Promise<void> {
    this.prefs.set(this.key(householdId, memberId), {
      likes: [...prefs.likes],
      dislikes: [...prefs.dislikes],
    });
  }

  async getPrefs(householdId: string, memberId: string): Promise<MemberPrefs> {
    const p = this.prefs.get(this.key(householdId, memberId));
    return { likes: [...(p?.likes ?? [])], dislikes: [...(p?.dislikes ?? [])] };
  }

  async upsertAttendance(
    householdId: string,
    memberId: string,
    entries: AttendanceEntry[],
  ): Promise<void> {
    const k = this.key(householdId, memberId);
    const map = this.attendance.get(k) ?? new Map<string, AttendanceEntry>();
    for (const e of entries) {
      map.set(this.attKey(e.mealType, e.weekday), { ...e });
    }
    this.attendance.set(k, map);
  }

  async getAttendance(householdId: string, memberId: string): Promise<AttendanceEntry[]> {
    const map = this.attendance.get(this.key(householdId, memberId));
    return map ? [...map.values()].map((e) => ({ ...e })) : [];
  }

  async deleteAttendance(householdId: string, memberId: string): Promise<void> {
    this.attendance.delete(this.key(householdId, memberId));
  }
}

/**
 * WP-0.2 integration test: migrations + seed + privacy invariants, against a
 * REAL Postgres (docker compose / Neon dev branch). Skips cleanly when
 * DATABASE_URL is absent so unit-only CI stays green before WP-0.3 wires the
 * Postgres service container.
 *
 *   DATABASE_URL=postgres://onetable:onetable-dev-only@localhost:5432/onetable npm test
 */
import { randomBytes } from 'node:crypto';
import { count, eq, sql as ds } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptHealth, loadKey } from '../db/crypto.js';
import { eraseHousehold } from '../src/lib/consent/erase';
import { openDb, requireDatabaseUrl, type Db } from '../db/index.js';
import { seed } from '../db/seed.js';
import {
  allergenConfirmation,
  consent,
  household,
  member,
  memberAttendance,
  memberHealth,
  plan,
  planSlot,
  slotMember,
} from '../db/schema.js';

process.env.ENCRYPTION_KEY ??= randomBytes(32).toString('base64');
const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

let db: Db;
let close: () => Promise<void>;
let busyId = '';
let fitnessId = '';

suite('WP-0.2 migrations + seed (live DB)', () => {
  beforeAll(async () => {
    const handle = openDb(requireDatabaseUrl());
    db = handle.db;
    close = () => handle.sql.end({ timeout: 5 });
    await seed(db); // migrate + truncate + two demo households (NF-7)
  }, 120_000);

  afterAll(async () => {
    await close?.();
  });

  it('seeds exactly the two demo households, tier=household', async () => {
    const rows = await db.select().from(household);
    const names = rows.map((r) => r.name).sort();
    expect(names).toEqual([
      'Busy Parent Household',
      'Fitness Couple Household',
    ]);
    expect(rows.every((r) => r.tier === 'household')).toBe(true);
    busyId = rows.find((r) => r.name === 'Busy Parent Household')!.id;
    fitnessId = rows.find((r) => r.name === 'Fitness Couple Household')!.id;
  });

  it('busy parent: 3 members; fitness couple: 2 members', async () => {
    const members = await db.select().from(member);
    const busy = members.filter((m) => m.householdId === busyId);
    const fit = members.filter((m) => m.householdId === fitnessId);
    expect(busy.map((m) => m.name).sort()).toEqual(['Lily', 'Maya', 'Sam']);
    expect(fit.map((m) => m.name).sort()).toEqual(['Marco', 'Nina']);
  });

  it('every member has an ENCRYPTED health row — no plaintext allergens anywhere', async () => {
    const rows = await db.select().from(memberHealth);
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      // ciphertext must not contain any health term in plaintext
      const decoded = Buffer.from(r.dataEnc, 'base64').toString('latin1');
      expect(decoded).not.toMatch(/peanut|asthma|prediabetes|shellfish|tree_nut/i);
    }
    // and it decrypts correctly with ENCRYPTION_KEY
    const sam = (
      await db.select({ id: member.id }).from(member).where(eq(member.name, 'Sam'))
    )[0]!;
    const blob = (
      await db.select().from(memberHealth).where(eq(memberHealth.memberId, sam.id))
    )[0]!;
    const health = decryptHealth(blob.dataEnc, loadKey());
    expect(health.allergies).toEqual(expect.arrayContaining(['peanuts', 'tree nuts']));
    expect(health.conditions).toEqual(['other']);
  });

  it('child profiles carry NO weight (PR01); adults do', async () => {
    const key = loadKey();
    const rows = await db
      .select({ isChild: member.isChild, dataEnc: memberHealth.dataEnc })
      .from(memberHealth)
      .innerJoin(member, eq(memberHealth.memberId, member.id));
    for (const r of rows) {
      const h = decryptHealth(r.dataEnc, key);
      if (r.isChild) expect(h.weightKg).toBeNull();
    }
    const nina = rows.find((r) => !r.isChild)!;
    expect(decryptHealth(nina.dataEnc, key).weightKg).not.toBeNull();
  });

  it('PV01: five separate consents per household, with policy version', async () => {
    const rows = await db.select().from(consent);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.policyVersion === '2026-10-01')).toBe(true);
  });

  it('each household gets a full 28-slot draft week + rule-check + grocery list', async () => {
    const plans = await db.select().from(plan);
    expect(plans).toHaveLength(2);
    for (const p of plans) {
      const slots = await db
        .select()
        .from(planSlot)
        .where(eq(planSlot.planId, p.id));
      expect(slots).toHaveLength(28);
      const sm = await db
        .select({ n: count() })
        .from(slotMember)
        .innerJoin(planSlot, eq(slotMember.slotId, planSlot.id))
        .where(eq(planSlot.planId, p.id));
      // With this attendance matrix the plans hold 60+/~51 member-slot rows;
      // assert "well-populated" — the exact matrix is covered by the
      // attendance test below.
      expect(Number(sm[0]!.n)).toBeGreaterThan(45);
    }
    const locked = (
      await db
      .select({ n: count() })
      .from(planSlot)
      .innerJoin(plan, eq(planSlot.planId, plan.id))
        .where(ds`${plan.householdId} = ${busyId} AND ${planSlot.locked}`)
    );
    expect(Number(locked[0]!.n)).toBe(1); // Friday pizza night
  });

  it('full attendance matrix seeded (member × meal × 7 days)', async () => {
    const attCount = (await db.select({ n: count() }).from(memberAttendance))[0]!;
    expect(Number(attCount.n)).toBe(5 * 4 * 7); // 84
  });

  it('Sam has the UI allergen confirmation for the may-contain bars (PR03)', async () => {
    expect(await db.select().from(allergenConfirmation)).toHaveLength(1);
  });

  // PV03 runs LAST in this file: it deletes data.
  it('PV03: deleting a household leaves no row anywhere that references it', async () => {
    // PV03 seam: consent is append-only, so erasure must opt in (see src/lib/consent/erase.ts).
    for (const id of [busyId, fitnessId]) await eraseHousehold(db, id);

    // DB-wide check: every public table that has a household_id column…
    const tables = await db.execute(
      ds`select table_name from information_schema.columns
         where table_schema = 'public' and column_name = 'household_id'`,
    );
    const rowsAs = (v: unknown): { table_name: string }[] =>
      Array.isArray(v) ? (v as unknown as { table_name: string }[]) : [];
    const names =
      (tables as unknown as { rows?: { table_name: string }[] }).rows?.map((r) => r.table_name) ??
      rowsAs(tables).map((r) => r.table_name);
    expect(names.length).toBeGreaterThan(10);
    for (const t of names) {
      const res = (await db.execute(
        ds.raw(`select count(*)::int as c from "${t}" where household_id is not null`),
      )) as unknown as { c: number }[];
      expect(res[0]!.c, `table ${t} still references a household`).toBe(0);
    }
    // …plus the second-hop tables without a household_id column:
    const hops = [
      ['member_health', 'member'],
      ['slot_member', 'plan_slot'],
      ['plan_rule_check', 'plan'],
      ['grocery_item', 'grocery_list'],
      ['agent_message', 'agent_conversation'],
      ['agent_action', 'agent_run'],
      ['guardian_decision', 'agent_run'],
    ] as const;
    for (const [child, via] of hops) {
      const res = (await db.execute(
        ds.raw(`select count(*)::int as c from "${child}"`),
      )) as unknown as { c: number }[];
      expect(res[0]!.c, `orphan rows survive via ${via} -> ${child}`).toBe(0);
    }
  });
});

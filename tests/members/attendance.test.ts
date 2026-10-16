// Meal attendance: rules + P-level flow (PR01 field / MP01 packed lunch).
import { describe, expect, it } from 'vitest';
import { makeHarness, ADULT } from '../helpers';

async function createAdult(h: ReturnType<typeof makeHarness>) {
  const { applied } = await h.applyWithApproval((ctx) =>
    h.service.createOrUpdateMember(ctx, { ...ADULT }),
  );
  if (!applied.ok || applied.status !== 'applied') throw new Error('setup failed');
  return applied.data;
}

describe('set_attendance validation', () => {
  const h = makeHarness();
  let memberId = '';

  it('rejects unknown meal types and out-of-range weekdays', async () => {
    memberId = (await createAdult(h)).id;
    const r1 = await h.service.setAttendance(h.uiCtx(), {
      memberId, entries: [{ mealType: 'brunch', weekday: 3, attending: true }],
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok && r1.error.issues) expect(r1.error.issues[0]?.code).toBe('not_allowed');

    const r2 = await h.service.setAttendance(h.uiCtx(), {
      memberId, entries: [{ mealType: 'lunch', weekday: 8, attending: true }],
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok && r2.error.issues) expect(r2.error.issues[0]?.field).toBe('entries[0].weekday');
  });

  it('packed is lunch-only', async () => {
    const r = await h.service.setAttendance(h.uiCtx(), {
      memberId, entries: [{ mealType: 'dinner', weekday: 2, attending: true, packed: true }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok && r.error.issues) expect(r.error.issues[0]?.message).toMatch(/packed is only for lunch/);
  });

  it('rejects an empty list, >28 entries and duplicates', async () => {
    expect((await h.service.setAttendance(h.uiCtx(), { memberId, entries: [] })).ok).toBe(false);
    const many = Array.from({ length: 29 }, (_, i) => ({ mealType: 'dinner', weekday: (i % 7) + 1, attending: true }));
    expect((await h.service.setAttendance(h.uiCtx(), { memberId, entries: many })).ok).toBe(false);
    const dup = [
      { mealType: 'lunch', weekday: 1, attending: false },
      { mealType: 'lunch', weekday: 1, attending: true },
    ];
    const r = await h.service.setAttendance(h.uiCtx(), { memberId, entries: dup });
    expect(r.ok).toBe(false);
  });

  it('unknown or cross-household member -> not_found', async () => {
    const r1 = await h.service.setAttendance(h.uiCtx(), {
      memberId: 'nope', entries: [{ mealType: 'lunch', weekday: 1, attending: true }],
    });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.error.code).toBe('not_found');

    const other = makeHarness();
    const otherId = (await createAdult(other)).id;
    const r2 = await h.service.setAttendance(h.uiCtx(), {
      memberId: otherId, entries: [{ mealType: 'lunch', weekday: 1, attending: true }],
    });
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error.code).toBe('not_found');
  });
});

describe('set_attendance is P-level and stores per slot+weekday', () => {
  it('proposes first, applies on approval, upserts on re-send', async () => {
    const h = makeHarness();
    const member = await (async () => {
      const { applied } = await h.applyWithApproval((ctx) => h.service.createOrUpdateMember(ctx, { ...ADULT }));
      if (!applied.ok || applied.status !== 'applied') throw new Error('setup');
      return applied.data;
    })();

    const input = {
      memberId: member.id,
      entries: [
        { mealType: 'lunch', weekday: 2, attending: false },
        { mealType: 'lunch', weekday: 3, attending: true, packed: true },
      ],
    };
    const p = await h.service.setAttendance(h.agentCtx(), input);
    expect(p.ok && p.status).toBe('pending_approval');
    if (p.ok && p.status === 'pending_approval') {
      expect(p.reviewCard.lines.join(' ')).toMatch(/Not home for lunch Tue/);
      expect(p.reviewCard.lines.join(' ')).toMatch(/Home for lunch Wed \(packed lunch\)/);
      expect(await h.repo.getAttendance(h.householdId, member.id)).toHaveLength(0); // nothing saved yet
    }

    const a = await h.service.setAttendance(h.agentCtx({ approvalId: p.ok && p.status === 'pending_approval' ? p.approvalId : '' }), input);
    expect(a.ok && a.status).toBe('applied');

    // upsert: change Tuesday's value only
    const r2 = await h.applyWithApproval((ctx) =>
      h.service.setAttendance(ctx, { memberId: member.id, entries: [{ mealType: 'lunch', weekday: 2, attending: true }] }),
    );
    expect(r2.applied.ok && r2.applied.status).toBe('applied');
    const rows = await h.repo.getAttendance(h.householdId, member.id);
    expect(rows).toHaveLength(2);
    const tue = rows.find((e) => e.weekday === 2);
    expect(tue?.attending).toBe(true);
    const wed = rows.find((e) => e.weekday === 3);
    expect(wed?.packed).toBe(true);

    const g = await h.service.getAttendance(h.agentCtx(), member.id);
    expect(g.ok && g.status === 'applied' ? g.data.length : 0).toBe(2);
  });
});

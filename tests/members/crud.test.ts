// Member profile CRUD: create / read / update / delete with household scoping.
import { describe, expect, it } from 'vitest';
import { makeHarness, ADULT, KID_11 } from '../helpers';

async function add(h: ReturnType<typeof makeHarness>, input: Record<string, unknown>) {
  const { applied } = await h.applyWithApproval((ctx) => h.service.createOrUpdateMember(ctx, input), undefined, { via: 'ui' });
  if (!applied.ok || applied.status !== 'applied') throw new Error('setup failed');
  return applied.data;
}

describe('CRUD via UI path (same server functions as the agent path)', () => {
  it('create -> list -> get round-trips the profile, prefs; health values stay out of reads', async () => {
    const h = makeHarness();
    h.consent.granted.add('allergies');
    const m = await add(h, { ...KID_11, likes: ['pasta'], allergies: ['peanut'] });

    const list = await h.service.listMembers(h.uiCtx());
    expect(list.ok && list.status === 'applied' ? list.data.length : 0).toBe(1);

    const g = await h.service.getMember(h.uiCtx(), m.id);
    expect(g.ok && g.status).toBe('applied');
    if (g.ok && g.status === 'applied') {
      expect(g.data.profile.name).toBe('Ravi');
      expect(g.data.prefs.likes).toEqual(['pasta']);
      // NF-P5: reads return no health values — get_member_summary (WP-1.3) exposes flags.
      expect(JSON.stringify(g.data)).not.toContain('peanut');
    }
    // the value went to the health store, not the member row
    const health = await h.health.getMemberHealth(m.id, h.householdId);
    expect(health?.allergies).toEqual(['peanut']);
  });

  it('update merges: omitted fields keep stored values; prefs untouched unless sent', async () => {
    const h = makeHarness();
    const m = await add(h, { ...ADULT, dietPattern: 'vegetarian', likes: ['dal'] });
    const updated = await add(h, { id: m.id, name: 'Priya R.', dislikes: ['okra'] });
    expect(updated.name).toBe('Priya R.');
    expect(updated.dietPattern).toBe('vegetarian'); // kept
    const prefs = await h.repo.getPrefs(h.householdId, m.id);
    expect(prefs.likes).toEqual(['dal']); // prefs preserved when not sent
    expect(prefs.dislikes).toEqual(['okra']);
  });

  it('update with an unknown id is not_found (never a silent create)', async () => {
    const h = makeHarness();
    const r = await h.service.createOrUpdateMember(h.uiCtx(), { id: 'ghost', ...ADULT });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('not_found');
  });

  it('households cannot read or write each other\'s members', async () => {
    const a = makeHarness();
    const mA = await add(a, { ...ADULT });

    // same repo, wrong household scope -> reads as not_found (no cross-household oracle)
    const stolen = await a.service.getMember({ householdId: a.otherHouseholdId, via: 'ui' }, mA.id);
    expect(stolen.ok).toBe(false);
    if (!stolen.ok) expect(stolen.error.code).toBe('not_found');

    const upd = await a.service.createOrUpdateMember(
      a.uiCtx({ householdId: a.otherHouseholdId }),
      { id: mA.id, name: 'Hijacked' },
    );
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.error.code).toBe('not_found');
    const still = await a.repo.getMember(a.householdId, mA.id);
    expect(still?.name).toBe('Priya');
  });

  it('delete_member is UI-only and cascades prefs + attendance + health', async () => {
    const h = makeHarness();
    h.consent.granted.add('measurements');
    const m = await add(h, { ...ADULT, heightCm: 165 });
    await h.applyWithApproval((ctx) =>
      h.service.setAttendance(ctx, { memberId: m.id, entries: [{ mealType: 'dinner', weekday: 5, attending: true }] }),
    );

    // agent path: refused even if it somehow reaches the service (X-level, defense in depth)
    const byAgent = await h.service.deleteMember(h.agentCtx(), m.id);
    expect(byAgent.ok).toBe(false);
    if (!byAgent.ok) expect(byAgent.error.code).toBe('x_level_forbidden');

    const del = await h.service.deleteMember(h.uiCtx(), m.id);
    expect(del.ok && del.status).toBe('applied');
    expect(await h.repo.getMember(h.householdId, m.id)).toBeNull();
    expect(await h.repo.getAttendance(h.householdId, m.id)).toHaveLength(0);
    expect(await h.health.getMemberHealth(m.id, h.householdId)).toBeNull();
  });
});

describe('member policy seam (WP-1.5 tier limits hook in here)', () => {
  it('a blocking policy prevents a second member and stores nothing (AC01 pattern)', async () => {
    const h = makeHarness({
      policy: {
        async canAddMember(_hh, existingCount) {
          return existingCount >= 1
            ? { ok: false, message: 'Free tier: one member profile. Upgrade to Household to add more.' }
            : { ok: true };
        },
      },
    });
    await add(h, { ...ADULT });
    const r = await h.applyWithApproval((ctx) => h.service.createOrUpdateMember(ctx, { ...KID_11 }));
    expect(r.applied.ok).toBe(false);
    if (!r.applied.ok) {
      expect(r.applied.error.code).toBe('policy_blocked');
      expect(r.applied.error.message).toMatch(/Free tier/);
    }
    expect(await h.repo.listMembers(h.householdId)).toHaveLength(1);
  });
});

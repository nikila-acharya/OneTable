// PV01 consent-gated writes through the WP-1.2 tool path.
import { describe, expect, it } from 'vitest';
import { makeHarness, ADULT, KID_11 } from '../helpers';

describe('consent-gated member writes (PV01)', () => {
  it('writing height without measurement consent fails and stores NOTHING (PV01 AC)', async () => {
    const h = makeHarness();
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT, heightCm: 165 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('consent_required');
      expect(r.error.consent?.dataType).toBe('measurements');
    }
    // whole write refused: no member row created
    expect(await h.repo.listMembers(h.householdId)).toHaveLength(0);
    // the rejection is visible in the action log (field names only)
    expect(h.actionLog.entries.at(-1)?.resultSummary).toMatchObject({ blocked: 'consent_required' });
  });

  it('allergies consent is separate from measurements consent', async () => {
    const h = makeHarness();
    h.consent.granted.add('measurements');
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...KID_11, allergies: ['peanut'], heightCm: 138 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('consent_required');
      expect(r.error.consent?.dataType).toBe('allergies');
    }
    expect(await h.repo.listMembers(h.householdId)).toHaveLength(0);
  });

  it('conditions writes need conditions consent', async () => {
    const h = makeHarness();
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT, conditions: ['hypertension'] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.consent?.dataType).toBe('conditions');
  });

  it('clearing a health value (null) does not need consent', async () => {
    const h = makeHarness();
    h.consent.granted.add('measurements');
    const { applied } = await h.applyWithApproval((ctx) =>
      h.service.createOrUpdateMember(ctx, { ...ADULT, heightCm: 165 }),
    );
    expect(applied.ok && applied.status).toBe('applied');
    if (applied.ok && applied.status === 'applied') {
      h.consent.granted.delete('measurements');
      const r = await h.applyWithApproval((ctx) =>
        h.service.createOrUpdateMember(ctx, { id: applied.data.id, heightCm: null }),
      );
      expect(r.applied.ok && r.applied.status).toBe('applied');
      const health = await h.health.getMemberHealth(applied.data.id, h.householdId);
      expect(health?.heightCm).toBeNull();
    }
  });

  it('a plain profile write (no health fields) works with zero consents granted', async () => {
    const h = makeHarness();
    const { applied } = await h.applyWithApproval((ctx) => h.service.createOrUpdateMember(ctx, { ...ADULT }));
    expect(applied.ok && applied.status).toBe('applied');
  });

  it('consent_required messages teach the agent to point at the UI, never grant consent itself', async () => {
    const h = makeHarness();
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT, weightKg: 70 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toMatch(/User must grant/);
      expect(r.error.message).toMatch(/cannot grant/);
    }
  });
});

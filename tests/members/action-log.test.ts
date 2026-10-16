// NF-P6: the action log never contains health values (names and counts only),
// and NF-P5 reads never leak them into agent context.
import { describe, expect, it } from 'vitest';
import { makeHarness, ADULT, KID_11 } from '../helpers';

describe('action-log redaction (NF-P6)', () => {
  it('a member write with allergies + measurements logs field NAMES, never values', async () => {
    const h = makeHarness();
    h.consent.granted.add('allergies');
    h.consent.granted.add('measurements');

    const { applied, proposal } = await h.applyWithApproval((ctx) =>
      h.service.createOrUpdateMember(ctx, {
        ...KID_11,
        allergies: ['peanut', 'milk'],
        heightCm: 138,
        likes: ['pasta'],
      }),
    );
    expect(applied.ok && applied.status).toBe('applied');
    if (!(applied.ok && applied.status === 'applied')) throw new Error('setup');
    if (!(proposal.ok && proposal.status === 'pending_approval')) throw new Error('setup');

    expect(proposal.reviewCard.lines.join(' ')).not.toMatch(/peanut|138/);
    const serialized = JSON.stringify(h.actionLog.entries);
    expect(serialized).not.toContain('peanut');
    expect(serialized).not.toContain('milk');
    expect(serialized).not.toContain('138');
    expect(serialized).not.toContain('pasta');
    // the member's display name is also kept out of logs — references only
    expect(serialized).not.toContain('Ravi');
    expect(serialized).toContain('allergies'); // names are fine
    expect(serialized).toContain('heightCm');
    expect(serialized).toContain('memberId');

    // both the proposal and the applied call are logged, per 7.7
    const pending = h.actionLog.entries.filter((e) => 'pending' in e.resultSummary);
    const done = h.actionLog.entries.filter((e) => e.resultSummary.applied === true);
    expect(pending.length + done.length).toBeGreaterThanOrEqual(2);
  });

  it('consent refusals are logged with the data type, not values', async () => {
    const h = makeHarness();
    await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT, weightKg: 71 });
    const last = h.actionLog.entries.at(-1);
    expect(last?.resultSummary).toMatchObject({ blocked: 'consent_required', dataType: 'measurements' });
    expect(JSON.stringify(last)).not.toContain('71');
  });

  it('delete is logged at X level with UI provenance', async () => {
    const h = makeHarness();
    const { applied } = await h.applyWithApproval((ctx) => h.service.createOrUpdateMember(ctx, { ...ADULT }), undefined, { via: 'ui' });
    if (!(applied.ok && applied.status === 'applied')) throw new Error('setup');
    await h.service.deleteMember(h.uiCtx(), applied.data.id);
    const last = h.actionLog.entries.at(-1);
    expect(last?.tool).toBe('delete_member');
    expect(last?.level).toBe('X');
    expect(last?.agent).toBeNull();
  });
});

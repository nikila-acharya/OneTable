// P-level semantics: propose -> approve -> only-then-write (PRD 7.2, 7.7, AG05).
import { describe, expect, it } from 'vitest';
import { makeHarness, ADULT, KID_11 } from '../helpers';

describe('create_or_update_member is P-level', () => {
  it('phase 1 changes NOTHING and returns a review card + approval id (AC PR01)', async () => {
    const h = makeHarness();
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT });
    expect(r.ok && r.status).toBe('pending_approval');
    if (r.ok && r.status === 'pending_approval') {
      expect(r.approvalId).toMatch(/[0-9a-f-]{36}/);
      expect(r.reviewCard.title).toBe('Add member Priya');
      expect(r.reviewCard.lines.some((l) => l.includes('age 38'))).toBe(true);
    }
    expect(await h.repo.listMembers(h.householdId)).toHaveLength(0);
    const approval = await h.approvals.get(r.ok && r.status === 'pending_approval' ? r.approvalId : 'x');
    expect(approval?.status).toBe('pending');
    expect(approval?.tool).toBe('create_or_update_member');
  });

  it('the review card hides health VALUES (agent context), while the approval keeps them for the User', async () => {
    const h = makeHarness();
    h.consent.granted.add('allergies');
    const r = await h.service.createOrUpdateMember(h.agentCtx(), { ...KID_11, allergies: ['peanut'] });
    expect(r.ok && r.status).toBe('pending_approval');
    if (r.ok && r.status === 'pending_approval') {
      const cardText = JSON.stringify(r.reviewCard);
      expect(cardText).not.toContain('peanut');
      expect(cardText).toContain('allergies');
      expect(cardText).toContain('value shown to you only');
    }
    const approval = r.ok && r.status === 'pending_approval' ? await h.approvals.get(r.approvalId) : null;
    expect(JSON.stringify(approval?.proposalJson)).toContain('peanut'); // for the User's own card
  });

  it('phase 2 applies after approval and marks the record approved', async () => {
    const h = makeHarness();
    const { applied, approvalId } = await h.applyWithApproval((ctx) =>
      h.service.createOrUpdateMember(ctx, { ...ADULT }),
    );
    expect(applied.ok && applied.status).toBe('applied');
    expect(await h.repo.listMembers(h.householdId)).toHaveLength(1);
    const approval = await h.approvals.get(approvalId);
    expect(approval?.status).toBe('approved');
    expect(approval?.decidedAt).not.toBeNull();
  });

  it('replay with a tampered payload under the same approvalId is refused (hash-bound)', async () => {
    const h = makeHarness();
    const proposal = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT });
    expect(proposal.ok && proposal.status).toBe('pending_approval');
    if (!(proposal.ok && proposal.status === 'pending_approval')) throw new Error('unreachable');
    const tampered = await h.service.createOrUpdateMember(
      h.agentCtx({ approvalId: proposal.approvalId }),
      { ...ADULT, name: 'Someone Else' },
    );
    expect(tampered.ok).toBe(false);
    if (!tampered.ok) expect(tampered.error.code).toBe('approval_invalid');
    expect(await h.repo.listMembers(h.householdId)).toHaveLength(0);
  });

  it('an approvalId from another household cannot apply', async () => {
    const h = makeHarness();
    const { approvalId } = await h.applyWithApproval((ctx) =>
      h.service.createOrUpdateMember(ctx, { ...ADULT }),
    ).catch(() => ({ approvalId: '', proposal: null, applied: null }));
    // applyWithApproval already applied in hh-aaaa; create a second proposal for a clean test:
    const p2 = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT, name: 'Second' });
    expect(p2.ok && p2.status).toBe('pending_approval');
    if (p2.ok && p2.status === 'pending_approval') {
      expect(p2.approvalId).not.toBe(approvalId);
      const foreign = await h.service.createOrUpdateMember(
        h.agentCtx({ householdId: h.otherHouseholdId, approvalId: p2.approvalId }),
        { ...ADULT, name: 'Second' },
      );
      expect(foreign.ok).toBe(false);
      if (!foreign.ok) expect(foreign.error.code).toBe('approval_invalid');
    }
  });

  it('expired approvals are refused and marked expired (7 days, PRD 7.7)', async () => {
    const h = makeHarness();
    const proposal = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT });
    if (!(proposal.ok && proposal.status === 'pending_approval')) throw new Error('expected proposal');
    h.setNow('2026-10-24T00:00:01Z'); // > 7 days after 2026-10-16T12:00Z
    const late = await h.service.createOrUpdateMember(h.agentCtx(), { ...ADULT });
    void late;
    const expired = await h.service.createOrUpdateMember(
      h.agentCtx({ approvalId: proposal.approvalId }),
      { ...ADULT },
    );
    expect(expired.ok).toBe(false);
    if (!expired.ok) expect(expired.error.code).toBe('approval_invalid');
    const approval = await h.approvals.get(proposal.approvalId);
    expect(approval?.status).toBe('expired');
  });

  it('double-apply of one approval is refused (status must be pending)', async () => {
    const h = makeHarness();
    const { approvalId, applied } = await h.applyWithApproval((ctx) =>
      h.service.createOrUpdateMember(ctx, { ...ADULT }),
    );
    expect(applied.ok && applied.status).toBe('applied');
    const second = await h.service.createOrUpdateMember(
      h.agentCtx({ approvalId }),
      { ...ADULT },
    );
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toMatch(/not pending/);
  });
});

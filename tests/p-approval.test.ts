// WP-0.5 — P-level two-phase approval (PRD 7.2 AC "every P-level tool checks for a
// matching approval record before it changes data", 7.7 AG05): the proposal card,
// the payload hash binding, expiry (7 days), and the decline path.

import { describe, expect, it } from 'vitest';
import { buildFullRegistry, callAs, T0 } from './helpers';
import { hashProposal } from '../agent/tools/approvals';

async function raiseProposal(reg: ReturnType<typeof buildFullRegistry>) {
  const input = { memberId: 'm-1', meal_type: 'dinner', attending: true };
  const first = await callAs(reg.registry, 'setup', 'create_or_update_member', { ...input, name: 'Asha' });
  expect(first.ok).toBe(true);
  if (!first.ok || first.outcome !== 'approval_requested') throw new Error('phase 1 must request approval');
  return { approvalId: first.approvalId, input: { ...input, name: 'Asha' } };
}

describe('P-level two-phase flow', () => {
  it('phase 1 creates a pending approval and changes no data', async () => {
    const reg = buildFullRegistry();
    const { approvalId } = await raiseProposal(reg);
    const record = await reg.approvals.get(approvalId);
    expect(record?.status).toBe('pending');
    expect(record?.tool).toBe('create_or_update_member');
    expect(record?.householdId).toBe('hh-demo');
    expect(reg.sink.calls).toHaveLength(0); // nothing executed
    // expiry = created + 7 days (PRD 7.7)
    expect(Date.parse(record!.expiresAt)).toBe(T0 + 7 * 86_400_000);
    expect(record!.proposalHash).toBe(hashProposal(record!.proposalJson));
  });

  it('phase 2 after the User approves runs the exact proposal', async () => {
    const reg = buildFullRegistry();
    const { approvalId, input } = await raiseProposal(reg);
    await reg.approvals.setStatus(approvalId, 'approved', reg.clock.now().toISOString());
    const second = await callAs(reg.registry, 'setup', 'create_or_update_member', { ...input, approvalId });
    expect(second.ok).toBe(true);
    expect(reg.sink.calls).toHaveLength(1);
    expect(reg.sink.calls[0]?.tool).toBe('create_or_update_member');
    // handler saw the approved payload WITHOUT the approvalId wrapper
    expect(reg.sink.calls[0]?.input).toEqual(input);
  });

  it('pending (not yet approved) cannot execute', async () => {
    const reg = buildFullRegistry();
    const { approvalId, input } = await raiseProposal(reg);
    const out = await callAs(reg.registry, 'setup', 'create_or_update_member', { ...input, approvalId });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('approval_not_approved');
    expect(reg.sink.calls).toHaveLength(0);
  });

  it('a declined approval never executes', async () => {
    const reg = buildFullRegistry();
    const { approvalId, input } = await raiseProposal(reg);
    await reg.approvals.setStatus(approvalId, 'declined', reg.clock.now().toISOString());
    const out = await callAs(reg.registry, 'setup', 'create_or_update_member', { ...input, approvalId });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('approval_not_approved');
    expect(reg.sink.calls).toHaveLength(0);
  });

  it('a swapped payload under the same approvalId is rejected (hash binding)', async () => {
    const reg = buildFullRegistry();
    const { approvalId, input } = await raiseProposal(reg);
    await reg.approvals.setStatus(approvalId, 'approved', reg.clock.now().toISOString());
    const tampered = { ...input, attending: false };
    const out = await callAs(reg.registry, 'setup', 'create_or_update_member', { ...tampered, approvalId });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('approval_payload_mismatch');
    expect(reg.sink.calls).toHaveLength(0);
  });

  it('an approval cannot be reused for a different tool or a different household', async () => {
    const reg = buildFullRegistry();
    const { approvalId, input } = await raiseProposal(reg);
    await reg.approvals.setStatus(approvalId, 'approved', reg.clock.now().toISOString());

    const wrongTool = await callAs(reg.registry, 'setup', 'set_attendance', { ...input, approvalId });
    expect(wrongTool.ok).toBe(false);
    if (!wrongTool.ok) expect(wrongTool.error).toBe('approval_wrong_tool');

    const otherHome = await callAs(reg.registry, 'setup', 'create_or_update_member', {
      ...input,
      approvalId,
      householdId: 'hh-other',
    } as never, { householdId: 'hh-other' });
    expect(otherHome.ok).toBe(false);
    if (!otherHome.ok) expect(otherHome.error).toBe('approval_wrong_household');
    expect(reg.sink.calls).toHaveLength(0);
  });

  it('a proposal older than 7 days is expired and cannot execute', async () => {
    const reg = buildFullRegistry();
    const { approvalId, input } = await raiseProposal(reg);
    await reg.approvals.setStatus(approvalId, 'approved', reg.clock.now().toISOString());
    reg.clock.advance(8); // one day past expiry
    const out = await callAs(reg.registry, 'setup', 'create_or_update_member', { ...input, approvalId });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('approval_expired');
    // and the store flipped to expired lazily (DbApprovalStore mirrors this on read)
    expect((await reg.approvals.get(approvalId))?.status).toBe('expired');
    expect(reg.sink.calls).toHaveLength(0);
  });

  it('an unknown approvalId is rejected', async () => {
    const reg = buildFullRegistry();
    const out = await callAs(reg.registry, 'setup', 'create_or_update_member', {
      name: 'Asha',
      approvalId: '00000000-0000-0000-0000-000000000000',
    });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe('approval_not_found');
  });

  it('every P phase-1 attempt is visible in the action log with the card id', async () => {
    const reg = buildFullRegistry();
    const { approvalId } = await raiseProposal(reg);
    const rows = reg.log.byTool('create_or_update_member');
    expect(rows.length).toBe(1);
    expect(rows[0]?.level).toBe('P');
    expect(rows[0]?.ok).toBe(true);
    expect(rows[0]?.resultSummary).toMatchObject({ outcome: 'approval_requested', approvalId });
  });
});

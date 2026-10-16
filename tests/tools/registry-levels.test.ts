// TR-TOOLS registration contract (PRD 7.2): fixed levels, JSON schemas,
// and X-level tools never visible to the agent.
import { describe, expect, it } from 'vitest';
import { buildMemberToolSpecs, toolsForAgent, wireMemberTools } from '../../lib/tools/member-tools';
import { createMemberService } from '../../lib/members/service';
import { InMemoryMemberRepository } from '../../lib/members/store';
import { InMemoryHealthWriter } from '../../lib/members/health';
import { InMemoryApprovalStore } from '../../lib/members/approvals';
import { denyAllConsent } from '../../lib/members/consent';

function specs() {
  const service = createMemberService({
    repo: new InMemoryMemberRepository(),
    health: new InMemoryHealthWriter(),
    approvals: new InMemoryApprovalStore(),
    consent: denyAllConsent,
  });
  return buildMemberToolSpecs(service);
}

describe('tool registry (WP-1.2 slice of 7.2)', () => {
  it('levels match the PRD table exactly', () => {
    const byName = Object.fromEntries(specs().map((s) => [s.name, s.level]));
    expect(byName).toMatchObject({
      create_or_update_member: 'P',
      set_attendance: 'P',
      list_members: 'R',
      get_member: 'R',
      get_attendance: 'R',
      delete_member: 'X',
    });
  });

  it('X-level tools are NOT registered for agents (AC 7.2)', () => {
    const agent = toolsForAgent(specs());
    expect(agent.map((s) => s.name)).not.toContain('delete_member');
    expect(agent.map((s) => s.level)).not.toContain('X');
    expect(agent).toHaveLength(5);
  });

  it('every tool carries a usable JSON schema and description', () => {
    for (const s of specs()) {
      expect(s.description.length).toBeGreaterThan(20);
      expect(s.jsonSchema.type).toBe('object');
      expect(typeof s.run).toBe('function');
    }
    const create = specs().find((s) => s.name === 'create_or_update_member')!;
    const props = create.jsonSchema.properties as Record<string, { enum?: string[] }>;
    expect(props['sex']?.enum).toEqual(['female', 'male', 'prefer_not_to_say']);
    expect(props['activityLevel']?.enum).toEqual(['sedentary', 'low_active', 'active', 'very_active']);
    expect(props['dietPattern']?.enum).toEqual(['omnivore', 'vegetarian', 'vegan', 'pescatarian', 'halal', 'kosher', 'other', null]);
    const att = specs().find((s) => s.name === 'set_attendance')!;
    expect(JSON.stringify(att.jsonSchema)).toContain('packed is only for lunch');
  });

  it('the level is fixed: the service refuses X writes from agent context regardless', async () => {
    const { service } = wireMemberTools({
      repo: new InMemoryMemberRepository(),
      health: new InMemoryHealthWriter(),
      approvals: new InMemoryApprovalStore(),
      consent: denyAllConsent,
    });
    const r = await service.deleteMember({ householdId: 'hh', via: 'agent' }, 'm1');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('x_level_forbidden');
  });
});

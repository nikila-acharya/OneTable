// Shared test harness: real service over in-memory ports, mutable clock, togglable consent.
import { InMemoryActionLog } from '../lib/members/action-log';
import { InMemoryApprovalStore } from '../lib/members/approvals';
import type { ConsentDataType } from '../lib/members/consent';
import { createMemberService, type MemberService, type ToolContext, type ToolResult } from '../lib/members/service';
import { InMemoryMemberRepository } from '../lib/members/store';
import { InMemoryHealthWriter } from '../lib/members/health';
import type { MemberPolicy } from '../lib/members/service';

export class TestConsentGate {
  readonly granted = new Set<ConsentDataType>();
  async hasConsent(_householdId: string, dataType: ConsentDataType): Promise<boolean> {
    return this.granted.has(dataType);
  }
}

export interface Harness {
  service: MemberService;
  repo: InMemoryMemberRepository;
  health: InMemoryHealthWriter;
  approvals: InMemoryApprovalStore;
  actionLog: InMemoryActionLog;
  consent: TestConsentGate;
  now: Date;
  setNow(iso: string): void;
  householdId: string;
  otherHouseholdId: string;
  agentCtx(over?: Partial<ToolContext>): ToolContext;
  uiCtx(over?: Partial<ToolContext>): ToolContext;
  /** Drive the full P two-phase flow: propose then replay with the approval id. */
  applyWithApproval<T>(
    run: (ctx: ToolContext) => Promise<ToolResult<T>>,
    input?: unknown,
    opts?: { via?: 'ui' | 'agent' },
  ): Promise<{ proposal: ToolResult<T>; applied: ToolResult<T>; approvalId: string }>;
}

export function makeHarness(opts?: { policy?: MemberPolicy }): Harness {
  const repo = new InMemoryMemberRepository();
  const health = new InMemoryHealthWriter();
  const approvals = new InMemoryApprovalStore();
  const actionLog = new InMemoryActionLog();
  const consent = new TestConsentGate();
  let now = new Date('2026-10-16T12:00:00Z');

  const householdId = 'hh-aaaa';
  const otherHouseholdId = 'hh-bbbb';

  const service = createMemberService({
    repo,
    health,
    approvals,
    actionLog,
    consent,
    policy: opts?.policy,
    approvalTtlMs: 7 * 24 * 60 * 60 * 1000,
  });

  const clock = () => now;

  function agentCtx(over?: Partial<ToolContext>): ToolContext {
    return {
      householdId,
      via: 'agent',
      agent: 'setup',
      runId: 'run-1',
      clock,
      ...over,
    };
  }
  function uiCtx(over?: Partial<ToolContext>): ToolContext {
    return { householdId, via: 'ui', clock, ...over };
  }

  async function applyWithApproval<T>(
    run: (ctx: ToolContext) => Promise<ToolResult<T>>,
    input?: unknown,
    o?: { via?: 'ui' | 'agent' },
  ): Promise<{ proposal: ToolResult<T>; applied: ToolResult<T>; approvalId: string }> {
    const mk = (approvalId?: string) =>
      (o?.via === 'ui' ? uiCtx({ approvalId }) : agentCtx({ approvalId }));
    const proposal = await run(mk());
    if (!proposal.ok || proposal.status !== 'pending_approval') {
      throw new Error('expected pending_approval from phase 1');
    }
    const applied = await run(mk(proposal.approvalId));
    return { proposal, applied, approvalId: proposal.approvalId };
  }

  return {
    service,
    repo,
    health,
    approvals,
    actionLog,
    consent,
    now,
    setNow(iso: string) {
      now = new Date(iso);
    },
    get householdId() {
      return householdId;
    },
    get otherHouseholdId() {
      return otherHouseholdId;
    },
    agentCtx,
    uiCtx,
    applyWithApproval,
  };
}

export const ADULT = {
  name: 'Priya',
  birthYm: '1988-04',
  sex: 'female',
  activityLevel: 'low_active',
} as const;

export const KID_11 = {
  name: 'Ravi',
  birthYm: '2015-06',
  sex: 'male',
  activityLevel: 'active',
} as const;

export const TEEN_14 = {
  name: 'Ana',
  birthYm: '2012-05',
  sex: 'female',
  activityLevel: 'sedentary',
} as const;

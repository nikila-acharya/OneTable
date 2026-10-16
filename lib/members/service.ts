// WP-1.2 member service: the single server function set behind the UI, the API and
// the agent tools (PRD 5.5/7.2 — "the UI and the agent call the same server
// functions, so the rules apply the same way to both").
//
// P-level semantics (7.2): create_or_update_member and set_attendance change nothing
// until a matching approval record exists. Phase 1 stores the proposal and returns a
// review card; phase 2 replays the same input with ctx.approvalId and the hash-bound
// approval before any write happens (AC: "every P-level tool checks for a matching
// approval record before it changes data").

import { randomUUID } from 'node:crypto';

import type { ActionLog } from './action-log';
import { hashProposal, type ApprovalRecord, type ApprovalStore } from './approvals';
import type { ConsentGate } from './consent';
import type { HealthWriter } from './health';
import {
  type AttendanceEntry,
  type MemberPrefs,
  type MemberRecord,
} from './types';
import {
  consentDataTypeForHealthKey,
  validateAttendanceInput,
  validateMemberInput,
  type ConsentDataType,
  type NormalizedMemberInput,
  type ValidationIssue,
} from './validation';
import type { MemberRepository } from './store';

// ---------- shared result types ----------

export interface ToolContext {
  householdId: string;
  via: 'ui' | 'agent';
  agent?: string | null;
  runId?: string | null;
  /** Phase 2 of a P-level call: id of the approval the User decided on. */
  approvalId?: string | null;
  /** Injectable clock (age boundaries, approval expiry). */
  clock?: () => Date;
}

export type ToolErrorCode =
  | 'validation_failed'
  | 'consent_required'
  | 'not_found'
  | 'approval_invalid'
  | 'policy_blocked'
  | 'x_level_forbidden';

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  issues?: ValidationIssue[];
  /** Present when code = consent_required (PV01): which consent is missing and for
   * which fields. The agent must relay this and never ask for consent itself (X). */
  consent?: { dataType: ConsentDataType; fields: string[] };
}

export interface ReviewCard {
  title: string;
  /** Plain-language lines. Health and measurement VALUES are never included (NF-P5/NF-P6):
   * the User sees real values in the inbox card, rendered from the stored proposal. */
  lines: string[];
  changedFields: string[];
}

export type ToolResult<T> =
  | { ok: true; status: 'applied'; data: T }
  | { ok: true; status: 'pending_approval'; approvalId: string; expiresAt: string; reviewCard: ReviewCard }
  | { ok: false; error: ToolError };

export interface MemberView {
  profile: MemberRecord;
  prefs: MemberPrefs;
  attendance: AttendanceEntry[];
}

/** Tier gate seam — WP-1.5 (AC01 free = 1 member) plugs in here; default allows all. */
export interface MemberPolicy {
  canAddMember(householdId: string, existingCount: number): Promise<{ ok: true } | { ok: false; code?: string; message: string }>;
}

export const allowAllMembers: MemberPolicy = {
  async canAddMember() {
    return { ok: true } as const;
  },
};

export interface MemberServiceDeps {
  repo: MemberRepository;
  consent: ConsentGate;
  health: HealthWriter;
  approvals: ApprovalStore;
  actionLog?: ActionLog;
  policy?: MemberPolicy;
  /** [Proposed] 7-day approval expiry (PRD 7.7). */
  approvalTtlMs?: number;
}

const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const TOOL_CREATE_OR_UPDATE = 'create_or_update_member';
const TOOL_SET_ATTENDANCE = 'set_attendance';
const TOOL_DELETE_MEMBER = 'delete_member';

// ---------- service ----------

export interface MemberService {
  createOrUpdateMember(ctx: ToolContext, input: unknown): Promise<ToolResult<MemberRecord>>;
  setAttendance(ctx: ToolContext, input: unknown): Promise<ToolResult<{ memberId: string; entries: AttendanceEntry[] }>>;
  deleteMember(ctx: ToolContext, memberId: string): Promise<ToolResult<{ memberId: string }>>;
  getMember(ctx: ToolContext, memberId: string): Promise<ToolResult<MemberView>>;
  listMembers(ctx: ToolContext): Promise<ToolResult<MemberRecord[]>>;
  getAttendance(ctx: ToolContext, memberId: string): Promise<ToolResult<AttendanceEntry[]>>;
}

export function createMemberService(deps: MemberServiceDeps): MemberService {
  const ttl = deps.approvalTtlMs ?? DEFAULT_TTL_MS;

  async function log(entry: {
    ctx: ToolContext;
    tool: string;
    level: 'P' | 'X' | 'R';
    memberId: string | null;
    inputsSummary: Record<string, unknown>;
    resultSummary: Record<string, unknown>;
  }): Promise<void> {
    if (!deps.actionLog) return;
    await deps.actionLog.record({
      at: (entry.ctx.clock?.() ?? new Date()).toISOString(),
      householdId: entry.ctx.householdId,
      tool: entry.tool,
      level: entry.level,
      runId: entry.ctx.runId ?? null,
      agent: entry.ctx.agent ?? null,
      memberId: entry.memberId,
      // NF-P6: summaries are field names and counts — never values.
      inputsSummary: entry.inputsSummary,
      resultSummary: entry.resultSummary,
    });
  }

  /** Collect the consents a health patch needs: only non-null SET operations do.
   * Clearing a value (null) never requires consent. */
  function requiredConsents(n: NormalizedMemberInput): Map<ConsentDataType, string[]> {
    const map = new Map<ConsentDataType, string[]>();
    for (const key of n.healthKeysTouched) {
      if (key in n.health && n.health[key] === null) continue;
      const dt = consentDataTypeForHealthKey(key);
      map.set(dt, [...(map.get(dt) ?? []), key]);
    }
    return map;
  }

  async function checkConsent(
    ctx: ToolContext,
    n: NormalizedMemberInput,
  ): Promise<ToolError | null> {
    for (const [dataType, fields] of requiredConsents(n)) {
      const granted = await deps.consent.hasConsent(ctx.householdId, dataType);
      if (!granted) {
        return {
          code: 'consent_required',
          message: `No consent for "${dataType}" data. Nothing was stored. The User must grant this consent in the Household privacy screen — the agent cannot grant it (PV01, X-level).`,
          consent: { dataType, fields },
        };
      }
    }
    return null;
  }

  function memberInputsSummary(n: NormalizedMemberInput): Record<string, unknown> {
    return {
      operation: n.id ? 'update' : 'create',
      memberId: n.id,
      profileFields: n.profileKeysTouched,
      prefsTouched: n.prefsTouched,
      healthFieldsTouched: n.healthKeysTouched, // names only (NF-P6)
    };
  }

  function buildMemberReviewCard(
    n: NormalizedMemberInput,
    existing: MemberRecord | null,
    ageYears: number,
  ): ReviewCard {
    const changedFields: string[] = [...n.profileKeysTouched, ...(n.prefsTouched ? ['likes', 'dislikes'] : []), ...n.healthKeysTouched];
    const lines: string[] = [];
    if (existing) {
      if (n.profileKeysTouched.includes('name') && n.name !== existing.name) lines.push(`Name: ${existing.name} → ${n.name}`);
      if (n.profileKeysTouched.includes('birthYm') && n.birthYm !== existing.birthYm) lines.push(`Birth month: ${existing.birthYm} → ${n.birthYm} (age ${ageYears})`);
      if (n.profileKeysTouched.includes('sex') && n.sex !== existing.sex) lines.push(`Sex: ${existing.sex} → ${n.sex}`);
      if (n.profileKeysTouched.includes('activityLevel') && n.activityLevel !== existing.activityLevel) lines.push(`Activity: ${existing.activityLevel} → ${n.activityLevel}`);
      if (n.profileKeysTouched.includes('dietPattern') && n.dietPattern !== existing.dietPattern) lines.push(`Diet pattern: ${existing.dietPattern ?? 'unset'} → ${n.dietPattern ?? 'unset'}`);
    } else {
      lines.push(`Adds ${n.name}, age ${ageYears}`);
      lines.push(`Sex ${n.sex}, activity ${n.activityLevel}${n.dietPattern ? `, diet ${n.dietPattern}` : ''}`);
    }
    if (n.prefsTouched) lines.push(`Likes: ${n.likes.length} tag(s), dislikes: ${n.dislikes.length} tag(s)`);
    for (const key of n.healthKeysTouched) {
      lines.push(n.health[key] === null ? `Clears ${key}` : `Sets ${key} (value shown to you only)`);
    }
    return {
      title: existing ? `Update member ${n.name}` : `Add member ${n.name}`,
      lines,
      changedFields,
    };
  }

  async function propose(ctx: ToolContext, tool: string, normalized: unknown, reviewCard: ReviewCard): Promise<{ approvalId: string; expiresAt: string }> {
    const now = ctx.clock?.() ?? new Date();
    const record: ApprovalRecord = {
      id: randomUUID(),
      householdId: ctx.householdId,
      tool,
      proposalJson: normalized,
      proposalHash: hashProposal({ tool, normalized }),
      status: 'pending',
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ttl).toISOString(),
      decidedAt: null,
    };
    await deps.approvals.create(record);
    return { approvalId: record.id, expiresAt: record.expiresAt };
  }

  /** Phase-2 verification: the approval must exist, match this household, this tool,
   * the exact proposal hash, still be pending, and not be expired. */
  async function verifyApproval(
    ctx: ToolContext,
    tool: string,
    normalized: unknown,
  ): Promise<{ ok: true; approval: ApprovalRecord } | { ok: false; error: ToolError }> {
    const approvalId = ctx.approvalId;
    if (!approvalId) {
      return { ok: false, error: { code: 'approval_invalid', message: 'approvalId required to apply a P-level change' } };
    }
    const approval = await deps.approvals.get(approvalId);
    if (!approval || approval.householdId !== ctx.householdId || approval.tool !== tool) {
      return { ok: false, error: { code: 'approval_invalid', message: 'No matching approval record for this household and tool' } };
    }
    if (approval.status !== 'pending') {
      return { ok: false, error: { code: 'approval_invalid', message: `Approval is ${approval.status}, not pending` } };
    }
    const now = ctx.clock?.() ?? new Date();
    if (now.toISOString() > approval.expiresAt) {
      await deps.approvals.setStatus(approval.id, 'expired', now.toISOString());
      return { ok: false, error: { code: 'approval_invalid', message: 'Approval expired — approvals last 7 days (PRD 7.7)' } };
    }
    if (approval.proposalHash !== hashProposal({ tool, normalized })) {
      return { ok: false, error: { code: 'approval_invalid', message: 'Proposal no longer matches the approval — the review card must be re-confirmed' } };
    }
    return { ok: true, approval };
  }

  // ---------- create_or_update_member (P) ----------

  async function createOrUpdateMember(ctx: ToolContext, input: unknown): Promise<ToolResult<MemberRecord>> {
    const now = ctx.clock?.() ?? new Date();

    const rawId = typeof input === 'object' && input !== null ? (input as Record<string, unknown>)['id'] : undefined;
    let existing: MemberRecord | null = null;
    let existingPrefs: MemberPrefs | null = null;
    if (typeof rawId === 'string' && rawId !== '') {
      existing = await deps.repo.getMember(ctx.householdId, rawId);
      if (!existing) {
        return { ok: false, error: { code: 'not_found', message: 'No member with that id in this household' } };
      }
      existingPrefs = await deps.repo.getPrefs(ctx.householdId, rawId);
    }

    const v = validateMemberInput(input, { now, existing, existingPrefs });
    if (!v.ok) {
      return { ok: false, error: { code: 'validation_failed', message: 'Member profile did not pass validation', issues: v.issues } };
    }
    const n = v.normalized;

    const consentErr = await checkConsent(ctx, n);
    if (consentErr) {
      await log({ ctx, tool: TOOL_CREATE_OR_UPDATE, level: 'P', memberId: n.id, inputsSummary: memberInputsSummary(n), resultSummary: { blocked: 'consent_required', dataType: consentErr.consent?.dataType } });
      return { ok: false, error: consentErr };
    }

    if (!ctx.approvalId) {
      // Phase 1: propose. Nothing is written (AC PR01: an agent-drafted profile is
      // not saved until the User confirms the review card).
      const card = buildMemberReviewCard(n, existing, v.ageYears);
      const { approvalId, expiresAt } = await propose(ctx, TOOL_CREATE_OR_UPDATE, n, card);
      await log({ ctx, tool: TOOL_CREATE_OR_UPDATE, level: 'P', memberId: n.id, inputsSummary: memberInputsSummary(n), resultSummary: { pending: approvalId } });
      return { ok: true, status: 'pending_approval', approvalId, expiresAt, reviewCard: card };
    }

    // Phase 2: verified approval, then write.
    const check = await verifyApproval(ctx, TOOL_CREATE_OR_UPDATE, n);
    if (!check.ok) return { ok: false, error: check.error };

    const isCreate = existing === null;
    if (isCreate) {
      const policy = await (deps.policy ?? allowAllMembers).canAddMember(ctx.householdId, (await deps.repo.listMembers(ctx.householdId)).length);
      if (!policy.ok) {
        return { ok: false, error: { code: 'policy_blocked', message: policy.message } };
      }
    } else if (n.id) {
      // re-read at apply time: the member may have been deleted since the proposal
      const fresh = await deps.repo.getMember(ctx.householdId, n.id);
      if (!fresh) {
        return { ok: false, error: { code: 'not_found', message: 'Member no longer exists; nothing was saved' } };
      }
    }

    const iso = now.toISOString();
    let member: MemberRecord;
    if (isCreate) {
      const id = randomUUID();
      member = await deps.repo.insertMember(id, {
        householdId: ctx.householdId,
        name: n.name,
        birthYm: n.birthYm,
        sex: n.sex,
        activityLevel: n.activityLevel,
        dietPattern: n.dietPattern,
        createdAt: iso,
        updatedAt: iso,
      });
    } else {
      member = await deps.repo.updateMember(ctx.householdId, n.id!, {
        name: n.name,
        birthYm: n.birthYm,
        sex: n.sex,
        activityLevel: n.activityLevel,
        dietPattern: n.dietPattern,
        updatedAt: iso,
      });
    }
    if (n.prefsTouched) {
      await deps.repo.setPrefs(ctx.householdId, member.id, { likes: n.likes, dislikes: n.dislikes });
    }
    if (n.healthKeysTouched.length > 0) {
      // WP-1.3 encrypts this at rest; WP-1.2 only routes it here, consent-checked.
      await deps.health.putMemberHealth(member.id, ctx.householdId, n.health);
    }
    await deps.approvals.setStatus(check.approval.id, 'approved', iso);
    await log({ ctx, tool: TOOL_CREATE_OR_UPDATE, level: 'P', memberId: member.id, inputsSummary: memberInputsSummary(n), resultSummary: { applied: true, operation: isCreate ? 'create' : 'update' } });
    return { ok: true, status: 'applied', data: member };
  }

  // ---------- set_attendance (P) ----------

  async function setAttendance(ctx: ToolContext, input: unknown): Promise<ToolResult<{ memberId: string; entries: AttendanceEntry[] }>> {
    const now = ctx.clock?.() ?? new Date();
    const v = validateAttendanceInput(input);
    if (!v.ok) {
      return { ok: false, error: { code: 'validation_failed', message: 'Attendance did not pass validation', issues: v.issues } };
    }
    const memberId = (input as { memberId: string }).memberId;
    const member = await deps.repo.getMember(ctx.householdId, memberId);
    if (!member) {
      return { ok: false, error: { code: 'not_found', message: 'No member with that id in this household' } };
    }

    const proposal = { memberId, entries: v.entries };
    const summary = { memberId, entryCount: v.entries.length };
    const card: ReviewCard = {
      title: `Attendance for ${member.name}`,
      lines: v.entries.map(
        (e) =>
          `${e.attending ? 'Home for' : 'Not home for'} ${e.mealType} ${weekdayName(e.weekday)}${e.packed ? ' (packed lunch)' : ''}`,
      ),
      changedFields: ['attendance'],
    };

    if (!ctx.approvalId) {
      const { approvalId, expiresAt } = await propose(ctx, TOOL_SET_ATTENDANCE, proposal, card);
      await log({ ctx, tool: TOOL_SET_ATTENDANCE, level: 'P', memberId, inputsSummary: summary, resultSummary: { pending: approvalId } });
      return { ok: true, status: 'pending_approval', approvalId, expiresAt, reviewCard: card };
    }

    const check = await verifyApproval(ctx, TOOL_SET_ATTENDANCE, proposal);
    if (!check.ok) return { ok: false, error: check.error };

    await deps.repo.upsertAttendance(ctx.householdId, memberId, v.entries);
    await deps.approvals.setStatus(check.approval.id, 'approved', now.toISOString());
    await log({ ctx, tool: TOOL_SET_ATTENDANCE, level: 'P', memberId, inputsSummary: summary, resultSummary: { applied: true, entryCount: v.entries.length } });
    return { ok: true, status: 'applied', data: { memberId, entries: await deps.repo.getAttendance(ctx.householdId, memberId) } };
  }

  // ---------- delete_member (X: UI-only) ----------

  async function deleteMember(ctx: ToolContext, memberId: string): Promise<ToolResult<{ memberId: string }>> {
    if (ctx.via === 'agent') {
      // Defense in depth: delete_member is X-level, never registered for agents
      // (AC 7.2). If a call reaches here anyway, refuse it.
      return { ok: false, error: { code: 'x_level_forbidden', message: 'Deletion is UI-only and never available to the agent (X-level, PV03)' } };
    }
    const member = await deps.repo.getMember(ctx.householdId, memberId);
    if (!member) {
      return { ok: false, error: { code: 'not_found', message: 'No member with that id in this household' } };
    }
    const now = (ctx.clock?.() ?? new Date()).toISOString();
    await deps.repo.deleteMember(ctx.householdId, memberId);
    await deps.health.deleteMemberHealth(memberId);
    await log({ ctx, tool: TOOL_DELETE_MEMBER, level: 'X', memberId, inputsSummary: { memberId }, resultSummary: { applied: true, operation: 'delete' } });
    return { ok: true, status: 'applied', data: { memberId } };
  }

  // ---------- read tools (R) ----------

  async function getMember(ctx: ToolContext, memberId: string): Promise<ToolResult<MemberView>> {
    const profile = await deps.repo.getMember(ctx.householdId, memberId);
    if (!profile) return { ok: false, error: { code: 'not_found', message: 'No member with that id in this household' } };
    // Health values are NOT part of this view (NF-P5): agents get flags via
    // get_member_summary (WP-1.3); the User's own UI reads the encrypted store directly.
    const [prefs, attendance] = await Promise.all([
      deps.repo.getPrefs(ctx.householdId, memberId),
      deps.repo.getAttendance(ctx.householdId, memberId),
    ]);
    return { ok: true, status: 'applied', data: { profile, prefs, attendance } };
  }

  async function listMembers(ctx: ToolContext): Promise<ToolResult<MemberRecord[]>> {
    return { ok: true, status: 'applied', data: await deps.repo.listMembers(ctx.householdId) };
  }

  async function getAttendance(ctx: ToolContext, memberId: string): Promise<ToolResult<AttendanceEntry[]>> {
    const member = await deps.repo.getMember(ctx.householdId, memberId);
    if (!member) return { ok: false, error: { code: 'not_found', message: 'No member with that id in this household' } };
    return { ok: true, status: 'applied', data: await deps.repo.getAttendance(ctx.householdId, memberId) };
  }

  return { createOrUpdateMember, setAttendance, deleteMember, getMember, listMembers, getAttendance };
}

const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function weekdayName(iso: number): string {
  return WEEKDAY_NAMES[iso - 1] ?? `day ${iso}`;
}

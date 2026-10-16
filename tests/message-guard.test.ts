/**
 * WP-1.4 — deterministic message guard tests (PRD 7.3 checks 1–3 seed,
 * SG01 bullet 3, SG-E). The Guardian LLM check is M4 (WP-4.2); these cover
 * only the deterministic layer that must exist for "no LLM advice" members.
 */
import { describe, expect, it } from 'vitest';

import { evaluateConditionGate } from '../lib/conditions/gate.js';
import {
  clinicianConfirmReply,
  decideAfterGuard,
  findGatedAdviceMarkers,
  guardMessage,
} from '../lib/conditions/message-guard.js';

const gated = evaluateConditionGate('m-dad', ['type_2_diabetes']);
const open = evaluateConditionGate('m-kid', ['other']);
const ctx = { gates: [gated] };
const mixedCtx = { gates: [gated, open] };

describe('guardMessage — SG01 "no LLM advice for these members"', () => {
  it('passes benign household copy even with a gated member in context', () => {
    const r = guardMessage('Dad picked salmon tonight — rice and broccoli on the side.', ctx);
    expect(r.allowed).toBe(true);
    expect(r.anyGated).toBe(true);
  });

  it('flags condition-management markers when the turn references a gated member', () => {
    const r = guardMessage('For his blood sugar, aim to keep glucose steady with a lower carb target.', ctx);
    expect(r.allowed).toBe(false);
    expect(r.findings.map((f) => f.check)).toContain('gated_advice');
  });

  it('does NOT apply the gated-advice check to non-gated turns', () => {
    const r = guardMessage('Grandma tracks her glucose with her own clinician plan.', { gates: [open] });
    expect(r.findings.every((f) => f.check !== 'gated_advice')).toBe(true);
  });

  it('general DGA language stays allowed in general-guidance mode (SG01 bullet 2)', () => {
    const r = guardMessage('We keep sodium general and low: DGA guidance suggests the usual limits, no member target set.', ctx);
    expect(r.allowed).toBe(true);
  });

  it('banned-copy failures block regardless of gating', () => {
    const r = guardMessage('This plan helps manage your diabetes.', { gates: [] });
    expect(r.allowed).toBe(false);
    expect(r.findings[0]?.check).toBe('banned_copy');
  });

  it('under-18 weight language blocks even when nothing else trips', () => {
    const r = guardMessage('Ava can start a weight loss routine with these meals.', {
      gates: [],
      underageNames: ['Ava'],
    });
    expect(r.allowed).toBe(false);
    expect(r.findings.map((f) => f.check)).toContain('under18');
  });

  it('marker scan is case-insensitive', () => {
    expect(findGatedAdviceMarkers('Ask about his INSULIN timing')).toContain('insulin');
  });
});

describe('clinicianConfirmReply — fixed message + tips verbatim (SG01 bullet 3, SG-E)', () => {
  it('is the fixed copy alone when there are no tips', () => {
    expect(clinicianConfirmReply()).toBe('General guidance only. Confirm with your clinician.');
  });

  it('appends matching tips word-for-word WITH their source', () => {
    const reply = clinicianConfirmReply([
      {
        text: 'Fill half your plate with vegetables and fruit.',
        sourceName: 'Dietary Guidelines for Americans 2020–2025',
        sourceUrl: 'https://www.dietaryguidelines.gov/',
      },
    ]);
    expect(reply.startsWith('General guidance only. Confirm with your clinician.\n')).toBe(true);
    expect(reply).toContain(
      'Fill half your plate with vegetables and fruit. — Dietary Guidelines for Americans 2020–2025 (https://www.dietaryguidelines.gov/)',
    );
  });
});

describe('decideAfterGuard — 7.3 regenerate-once-then-fallback semantics', () => {
  const bad = 'You should adjust his insulin dose at dinner.';

  it('passes clean text untouched', () => {
    const d = decideAfterGuard('Salmon night it is.', ctx, 1);
    expect(d.outcome).toBe('pass');
  });

  it('first failure asks for one regeneration with the reason (never silently edits)', () => {
    const d = decideAfterGuard(bad, ctx, 1);
    expect(d.outcome).toBe('regenerate');
    if (d.outcome === 'regenerate') expect(d.reason).toContain('gated_advice');
  });

  it('second failure falls back to the fixed clinician message for gated turns', () => {
    const d = decideAfterGuard(bad, ctx, 2);
    expect(d.outcome).toBe('fallback');
    if (d.outcome === 'fallback') {
      expect(d.text).toBe('General guidance only. Confirm with your clinician.');
      expect(d.logged).toBe(true);
    }
  });

  it('second failure in a non-gated turn falls back to the banner copy, not the bad text', () => {
    const d = decideAfterGuard('A guilt-free cheat day awaits!', { gates: [open] }, 2);
    expect(d.outcome).toBe('fallback');
    if (d.outcome === 'fallback') expect(d.text).toContain('General guidance only.');
  });

  it('mixed household: any gated member in context triggers the clinician fallback', () => {
    const d = decideAfterGuard('her glucose looks fine now', mixedCtx, 2);
    expect(d.outcome === 'fallback' && d.text).toBe('General guidance only. Confirm with your clinician.');
  });
});

/**
 * WP-1.4 — ClinicianBanner render tests (SG01 persistent banner; PRD 16.5
 * member-sheet rule; 16.6 text-is-present rule). Rendered with
 * react-dom/server so no browser/DOM library is needed in CI.
 */
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ClinicianBanner } from '../components/ClinicianBanner.js';
import { evaluateConditionGate } from '../lib/conditions/gate.js';

describe('ClinicianBanner', () => {
  it('renders nothing for a non-gated member', () => {
    const gate = evaluateConditionGate('m', []);
    expect(renderToStaticMarkup(<ClinicianBanner gate={gate} />)).toBe('');
  });

  it('shows the exact fixed copy for a gated member', () => {
    const gate = evaluateConditionGate('m', ['chronic_kidney_disease']);
    const html = renderToStaticMarkup(<ClinicianBanner gate={gate} />);
    expect(html).toContain('General guidance only. Confirm with your clinician.');
    expect(html).toContain('data-testid="clinician-banner"');
  });

  it('includes the member name and the gating condition labels (plain-language, NF-5)', () => {
    const gate = evaluateConditionGate('m', ['type_1_diabetes', 'celiac_disease']);
    const html = renderToStaticMarkup(<ClinicianBanner gate={gate} memberName="Sam" />);
    expect(html).toContain('For Sam:');
    expect(html).toContain('Type 1 diabetes');
    expect(html).toContain('Celiac disease');
  });

  it('carries the trigger slugs for test hooks (data-triggers)', () => {
    const gate = evaluateConditionGate('m', ['hypertension']);
    const html = renderToStaticMarkup(<ClinicianBanner gate={gate} />);
    expect(html).toContain('data-triggers="hypertension"');
  });

  it('the rendered banner contains no banned-copy terms (6.4 lint runs on it)', () => {
    const gate = evaluateConditionGate('m', ['pregnancy']);
    const html = renderToStaticMarkup(<ClinicianBanner gate={gate} memberName="Ana" />);
    // Deliberately naive substring scan; the real lint (WP-0.3) imports the term list.
    const banned = ['treat', 'cure', 'skinny', 'detox', 'cheat'];
    const lower = html.toLowerCase();
    for (const term of banned) expect(lower).not.toContain(term);
  });
});

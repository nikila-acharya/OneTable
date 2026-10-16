/**
 * WP-1.4 — the persistent clinician banner (SG01; PRD 16.5: "choosing a
 * listed condition shows the clinician-confirm note right away"; 5.2 SG01:
 * shown "plainly and persistently" on the member profile and every plan view).
 *
 * Presentational only: the visibility decision is the gate's
 * (`evaluateConditionGate(...).showClinicianBanner`), the exact string is
 * `CLINICIAN_BANNER_COPY` — never retypes it here (single source of truth,
 * checked by tests against the PRD). Colors come from WP-0.6 design tokens
 * (`--sand`, `--warn-soft-ink`) with literal fallbacks so the component works
 * before the token stylesheet lands. Text always present: color is never the
 * only signal (PRD 16.6 / NF-3).
 */

import type { ConditionGateResult } from '../lib/conditions/gate.js';
import { CLINICIAN_BANNER_COPY, CONDITION_LABELS } from '../lib/conditions/index.js';

export interface ClinicianBannerProps {
  /** Gate result for the member this view is about. Banner hides when not gated. */
  readonly gate: Pick<ConditionGateResult, 'showClinicianBanner' | 'triggers'>;
  /** Optional display name — member sheets read "For {name}: ...". */
  readonly memberName?: string;
  readonly className?: string;
}

export function ClinicianBanner({ gate, memberName, className }: ClinicianBannerProps) {
  if (!gate.showClinicianBanner) return null;
  return (
    <aside
      aria-label="Clinician guidance notice"
      data-testid="clinician-banner"
      data-triggers={gate.triggers.join(',')}
      className={className}
      style={{
        background: 'var(--sand, #EEDFC7)',
        color: 'var(--warn-soft-ink, #7A5426)',
        border: '1px solid var(--sand-line, #E2CFAE)',
        borderRadius: 'var(--radius-md, 12px)',
        padding: '12px 16px',
        fontSize: 'var(--text-md, 15px)',
        fontWeight: 600,
      }}
    >
      {memberName ? `For ${memberName}: ` : ''}
      {CLINICIAN_BANNER_COPY}
      {gate.triggers.length > 0 && (
        <span> ({gate.triggers.map((slug) => CONDITION_LABELS[slug]).join(', ')})</span>
      )}
    </aside>
  );
}

/**
 * WP-1.4 — SG01 condition gate module barrel.
 *
 * Consumers (planner engine M3, tool layer WP-0.5/WP-1.3, Safety Guardian
 * WP-4.2, onboarding/plan UI WP-1.6 & WP-3.6) should import from here so the
 * internal file layout stays free to move (see
 * docs/decisions/114-sg01-condition-gate-contract.md).
 */

export * from './enum.js';
export * from './policy.js';
export * from './gate.js';
export * from './copy.js';
export * from './message-guard.js';

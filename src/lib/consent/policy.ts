/**
 * Current consent policy version. A bump makes every earlier grant
 * `requires_reconsent` (writes blocked until the household agrees again).
 */
export const DEFAULT_POLICY_VERSION = "2026-10-16";

export function currentPolicyVersion(env: Record<string, string | undefined> = process.env): string {
  const v = env.CONSENT_POLICY_VERSION?.trim();
  return v && v.length > 0 ? v : DEFAULT_POLICY_VERSION;
}

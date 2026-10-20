// lib/auth/email.ts — email normalization for the single login identifier.
// Owned by WP-0.4. The users table stores and looks up normalized values only.
//
// Policy (deliberately minimal, AC01): trim + lower-case. We do NOT strip
// dots or plus-tags — treating `a.b+c@x.com` and `ab@x.com` as one identity
// silently merges different inboxes and breaks magic-link delivery.

export class InvalidEmailError extends Error {
  constructor() {
    super('invalid email address');
    this.name = 'InvalidEmailError';
  }
}

export function normalizeEmail(input: unknown): string {
  if (typeof input !== 'string') throw new InvalidEmailError();
  const value = input.trim().toLowerCase();
  // shape-only check: exactly one @, non-empty local part, domain has a dot
  // label — full deliverability is the SMTP link's job, not validation here.
  const ok = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(value);
  if (!ok) throw new InvalidEmailError();
  return value;
}

/** Try to normalize; returns null instead of throwing (for request parsing). */
export function tryNormalizeEmail(input: unknown): string | null {
  try {
    return normalizeEmail(input);
  } catch {
    return null;
  }
}

/** Mask an address for logs (NF-P6 hygiene): "a***@ex***e.com". */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const head = local.slice(0, 1);
  const domainParts = domain.split('.');
  const tld = domainParts.at(-1) ?? '';
  const firstDomainLabel = domainParts[0] ?? '';
  const domainMask = `${firstDomainLabel.slice(0, 2)}***${tld ? `.${tld}` : ''}`;
  return `${head}***@${domainMask}`;
}

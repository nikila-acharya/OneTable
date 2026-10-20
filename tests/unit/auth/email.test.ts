// WP-0.4 — email normalization tests (single login identifier policy).
import { describe, expect, it } from 'vitest';
import {
  InvalidEmailError,
  maskEmail,
  normalizeEmail,
  tryNormalizeEmail,
} from '@/lib/auth/email';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Alice+Tag@Example.COM  ')).toBe('alice+tag@example.com');
  });

  it('keeps dots and plus-tags (different inbox, different identity)', () => {
    expect(normalizeEmail('a.b+c@x.co')).toBe('a.b+c@x.co');
  });

  it('accepts multi-label domains', () => {
    expect(normalizeEmail('me@mail.corp.example.co.uk')).toBe('me@mail.corp.example.co.uk');
  });

  it('rejects malformed addresses', () => {
    for (const bad of ['', '   ', 'plainaddress', '@no-local.com', 'no-domain@', 'a b@c.com', 'a@@b.com', 'a@b', 'a@.com', null, undefined, 42]) {
      expect(() => normalizeEmail(bad)).toThrow(InvalidEmailError);
    }
  });
});

describe('tryNormalizeEmail', () => {
  it('returns null instead of throwing', () => {
    expect(tryNormalizeEmail('NOPE')).toBeNull();
    expect(tryNormalizeEmail(' OK@Example.com ')).toBe('ok@example.com');
  });
});

describe('maskEmail (log hygiene, NF-P6 spirit)', () => {
  it('keeps only the first local char and the tld', () => {
    expect(maskEmail('alice@example.com')).toBe('a***@ex***.com');
  });

  it('handles junk without crashing', () => {
    expect(maskEmail('not-an-email')).toBe('***');
  });
});

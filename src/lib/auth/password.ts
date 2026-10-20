// lib/auth/password.ts — password hashing for the Auth.js credentials
// provider. scrypt from node:crypto (memory-hard, no native build needed on
// the Windows dev machine). Owned by WP-0.4.
//
// Stored format: scrypt$N$r$p$saltB64$hashB64  — parameters travel with each
// hash so old hashes keep verifying after a parameter bump and get upgraded
// opportunistically on next sign-in.
//
// Health data never touches this module (NF-P1/WP-1.3); AC01 login is email +
// password **or** magic link, and a magic-link-only user has passwordHash NULL.
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

// node's promisify overload-picks the 3-arg scrypt signature, losing the
// options (N/r/p/maxmem) argument we need — declare the shape explicitly.
const scryptAsync: (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer> = promisify(scrypt) as never;

/** OWASP-aligned scrypt parameters: N=2^15, r=8, p=1 → 32 MiB memory. */
export const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 } as const;
const KEYLEN = 32;
const SALT_BYTES = 16;
const MAX_PASSWORD_CHARS = 1024; // scrypt DoS guard; UI can be stricter

export class PasswordError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PasswordError';
  }
}

function scryptKey(password: string, salt: Buffer, N: number, r: number, p: number): Promise<Buffer> {
  // maxmem must cover 128*N*r with headroom (node's default limit is exactly
  // 32 MiB, which scrypt overflows at N=2^15,r=8 — be explicit).
  return scryptAsync(password, salt, KEYLEN, { N, r, p, maxmem: 128 * N * r * 2 }) as Promise<Buffer>;
}

export async function hashPassword(password: string): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) {
    throw new PasswordError('password must be a non-empty string');
  }
  if (password.length > MAX_PASSWORD_CHARS) {
    throw new PasswordError(`password longer than ${MAX_PASSWORD_CHARS} characters`);
  }
  const { N, r, p } = SCRYPT_PARAMS;
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptKey(password, salt, N, r, p);
  return [
    'scrypt',
    N,
    r,
    p,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Verify a candidate password against a stored envelope.
 * Returns false for a wrong password; throws PasswordError only when the
 * stored value itself is malformed (data corruption — loud, not silent).
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  if (password.length === 0 || password.length > MAX_PASSWORD_CHARS) return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    throw new PasswordError('malformed password hash envelope');
  }
  const [prefix, nStr, rStr, pStr, saltB64, hashB64] = parts as [
    'scrypt', string, string, string, string, string,
  ];
  void prefix;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p) || N < 2 || r < 1 || p < 1) {
    throw new PasswordError('malformed password hash parameters');
  }
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(hashB64, 'base64');
  if (expected.length !== KEYLEN || salt.length === 0) {
    // Structurally corrupt stored value: loud, like the malformed envelope above.
    throw new PasswordError('malformed password hash: bad key or salt length');
  }
  const derived = await scryptKey(password, salt, N, r, p);
  return timingSafeEqual(derived, expected);
}

// Cache for the anti user-enumeration dummy comparison (see users.ts):
// a wrong-password attempt and a no-such-user attempt take the same scrypt
// time, so response latency cannot be used to probe which emails exist.
let dummyHashPromise: Promise<string> | null = null;

export function getDummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) {
    dummyHashPromise = hashPassword(`dummy-${randomBytes(16).toString('hex')}-never-valid`);
  }
  return dummyHashPromise;
}

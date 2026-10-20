// WP-0.4 — tests for scrypt password hashing.
import { scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  PasswordError,
  SCRYPT_PARAMS,
  getDummyPasswordHash,
  hashPassword,
  verifyPassword,
} from '@/lib/auth/password';

// Same overload caveat as lib/auth/password.ts: declare the options-taking shape.
const scryptAsync: (
  password: string,
  salt: Buffer,
  keylen: number,
  options: import('node:crypto').ScryptOptions,
) => Promise<Buffer> = promisify(scrypt) as never;

describe('hashPassword', () => {
  it('produces the documented scrypt envelope', async () => {
    const stored = await hashPassword('correct horse battery staple');
    const parts = stored.split('$');
    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBe(SCRYPT_PARAMS.N);
    expect(Number(parts[2])).toBe(SCRYPT_PARAMS.r);
    expect(Number(parts[3])).toBe(SCRYPT_PARAMS.p);
  });

  it('uses a fresh salt per hash', async () => {
    const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('rejects empty or over-long passwords', async () => {
    await expect(hashPassword('')).rejects.toThrow(PasswordError);
    await expect(hashPassword('x'.repeat(1025))).rejects.toThrow(PasswordError);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password, rejects a wrong one', async () => {
    const stored = await hashPassword('🔪 chop-sabí 🥬');
    expect(await verifyPassword('🔪 chop-sabí 🥬', stored)).toBe(true);
    expect(await verifyPassword('🔪 chop-sabi 🥬', stored)).toBe(false);
  });

  it('rejects malformed stored envelopes loudly (data corruption)', async () => {
    const stored = await hashPassword('pw');
    await expect(verifyPassword('pw', stored.slice(0, -2))).rejects.toThrow();
    await expect(verifyPassword('pw', 'not-a-envelope')).rejects.toThrow(PasswordError);
    await expect(verifyPassword('pw', 'bcrypt$10$abc$def')).rejects.toThrow(PasswordError);
    await expect(verifyPassword('pw', 'scrypt$1$2$3$4')).rejects.toThrow(PasswordError);
  });

  it('rejects empty candidates and structurally corrupt stored hashes', async () => {
    const validEnvelope = 'scrypt$1024$8$1$' + Buffer.alloc(16, 3).toString('base64') + '$' + Buffer.alloc(32, 4).toString('base64');
    expect(await verifyPassword('', validEnvelope)).toBe(false);
    const wrongLen = ['scrypt', 1024, 8, 1, Buffer.alloc(16).toString('base64'), Buffer.alloc(8).toString('base64')].join('$');
    await expect(verifyPassword('anything', wrongLen)).rejects.toThrow(/bad key or salt length/);
  });

  it('honours parameters embedded in the stored envelope (upgradability)', async () => {
    // Hand-craft a legacy-strength hash (small N) and verify it with the same
    // code path — proof that a future parameter bump keeps old logins working.
    const N = 1024;
    const r = 8;
    const p = 1;
    const salt = Buffer.alloc(16, 7);
    const hash = await scryptAsync('legacy-pw', salt, 32, {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    });
    const stored = ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
    expect(await verifyPassword('legacy-pw', stored)).toBe(true);
    expect(await verifyPassword('nope', stored)).toBe(false);
  });
});

describe('getDummyPasswordHash (anti-enumeration timing equalizer)', () => {
  it('is stable and never verifies a real candidate', async () => {
    const first = await getDummyPasswordHash();
    const second = await getDummyPasswordHash();
    expect(second).toBe(first);
    expect(await verifyPassword('anything', first)).toBe(false);
  });
});

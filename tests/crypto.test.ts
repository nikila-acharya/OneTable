/** Crypto helper unit tests — no database required. */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptHealth, decryptJson, encryptHealth, encryptJson, loadKey } from '../db/crypto.js';
import type { MemberHealthData } from '../db/schema.js';

const KEY = randomBytes(32).toString('base64');

describe('db/crypto AES-256-GCM', () => {
  it('round-trips member health payloads', () => {
    const key = loadKey({ ENCRYPTION_KEY: KEY });
    const data: MemberHealthData = {
      heightCm: 142,
      weightKg: null,
      conditions: ['asthma'],
      allergies: ['peanut', 'tree_nut'],
      otherAllergens: ['kiwi fuzz'],
    };
    const blob = encryptHealth(data, key);
    const back = decryptHealth(blob, key);
    expect(back).toEqual(data);
  });

  it('never leaks plaintext into the blob', () => {
    const key = loadKey({ ENCRYPTION_KEY: KEY });
    const blob = encryptJson({ secrets: 'peanut allergy', n: 1 }, key);
    const raw = Buffer.from(blob, 'base64').toString('latin1');
    expect(raw).not.toContain('peanut');
  });

  it('two encryptions of the same value differ (random IV)', () => {
    const key = loadKey({ ENCRYPTION_KEY: KEY });
    expect(encryptJson({ a: 1 }, key)).not.toBe(encryptJson({ a: 1 }, key));
  });

  it('rejects tampering (GCM auth tag)', () => {
    const key = loadKey({ ENCRYPTION_KEY: KEY });
    const blob = encryptJson({ a: 1 }, key);
    const buf = Buffer.from(blob, 'base64');
    buf[buf.length - 1] = (buf[buf.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptJson(buf.toString('base64'), key)).toThrow();
  });

  it('loadKey validates length and presence', () => {
    expect(() => loadKey({})).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => loadKey({ ENCRYPTION_KEY: Buffer.alloc(24).toString('base64') })).toThrow(
      /32 bytes/,
    );
  });
});

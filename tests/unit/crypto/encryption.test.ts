// WP-0.4 — tests for the NF-P1 AES-256-GCM helper.
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  EncryptionError,
  decryptJson,
  decryptString,
  encryptJson,
  encryptString,
  getEncryptionKey,
  loadKeyFromEnv,
  parseKey,
  resetEncryptionKeyCache,
} from '@/lib/crypto/encryption';

const IV_BYTES = 12;
const b64Key32 = () => randomBytes(32).toString('base64');

describe('key loading (NF-P1: key from env, never the repo)', () => {
  const ENV = 'ENCRYPTION_KEY';
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env[ENV];
    resetEncryptionKeyCache();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
    resetEncryptionKeyCache();
  });

  it('accepts canonical base64 of exactly 32 bytes', () => {
    const raw = randomBytes(32);
    expect(parseKey(raw.toString('base64'))).toEqual(raw);
  });

  it('accepts surrounding whitespace', () => {
    const b64 = b64Key32();
    expect(parseKey(`  ${b64}\n`)).toHaveLength(32);
  });

  it('rejects keys decoding to the wrong length or empty', () => {
    expect(() => parseKey(randomBytes(31).toString('base64'))).toThrow(EncryptionError);
    expect(() => parseKey(randomBytes(33).toString('base64'))).toThrow(EncryptionError);
    expect(() => parseKey('')).toThrow(EncryptionError);
  });

  it('rejects non-canonical base64 (truncated padding)', () => {
    const mangled = randomBytes(32).toString('base64').slice(0, -1);
    expect(() => parseKey(mangled)).toThrow(EncryptionError);
  });

  it('rejects garbage with an actionable message', () => {
    expect(() => parseKey('not-a-key!')).toThrow(/must be standard base64/);
  });

  it('explains how to generate the key when env is missing', () => {
    delete process.env[ENV];
    expect(() => loadKeyFromEnv()).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => loadKeyFromEnv()).toThrow(/randomBytes\(32\)/);
  });

  it('caches the key and re-reads after reset', () => {
    process.env[ENV] = b64Key32();
    const first = getEncryptionKey();
    expect(getEncryptionKey()).toBe(first);
    resetEncryptionKeyCache();
    process.env[ENV] = b64Key32();
    expect(getEncryptionKey()).not.toBe(first);
  });
});

describe('encryptString / decryptString', () => {
  const key = () => randomBytes(32);

  function flipByte(envelope: string, indexFromEnd: number | null): string {
    const [version, body] = envelope.split(':');
    const raw = Buffer.from(body ?? '', 'base64');
    const idx = indexFromEnd === null ? IV_BYTES : raw.length - indexFromEnd;
    const cur = raw[idx];
    if (cur === undefined) throw new Error('flipByte: index out of range');
    raw[idx] = cur ^ 0xff;
    return `${version}:${raw.toString('base64')}`;
  }

  it('round-trips a string', () => {
    const k = key();
    expect(decryptString(encryptString('peanut, tree nut', { key: k }), { key: k })).toBe(
      'peanut, tree nut',
    );
  });

  it('round-trips the empty string', () => {
    const k = key();
    expect(decryptString(encryptString('', { key: k }), { key: k })).toBe('');
  });

  it('round-trips unicode (emoji, CJK, RTL)', () => {
    const k = key();
    const text = '🍕 pizza 🍕 — 日本語のメモ — صبا';
    expect(decryptString(encryptString(text, { key: k }), { key: k })).toBe(text);
  });

  it('round-trips a 100 KB payload', () => {
    const k = key();
    const big = 'allergy;'.repeat(12_500);
    expect(decryptString(encryptString(big, { key: k }), { key: k })).toBe(big);
  });

  it('produces v1 envelopes', () => {
    expect(encryptString('x', { key: key() })).toMatch(/^v1:[A-Za-z0-9+/=]+$/);
  });

  it('uses a fresh IV per call (two encryptions of the same value differ)', () => {
    const k = key();
    const a = encryptString('same', { key: k });
    const b = encryptString('same', { key: k });
    expect(a).not.toBe(b);
    expect(decryptString(a, { key: k })).toBe('same');
    expect(decryptString(b, { key: k })).toBe('same');
  });

  it('refuses to decrypt with the wrong key', () => {
    const envelope = encryptString('secret', { key: key() });
    expect(() => decryptString(envelope, { key: key() })).toThrow(EncryptionError);
  });

  it('detects a tampered ciphertext byte', () => {
    const k = key();
    const envelope = encryptString('{"conditions":["diabetes"]}', { key: k });
    expect(() => decryptString(flipByte(envelope, null), { key: k })).toThrow(/decryption failed/);
  });

  it('detects a tampered auth tag', () => {
    const k = key();
    const envelope = encryptString('x', { key: k });
    expect(() => decryptString(flipByte(envelope, 1), { key: k })).toThrow(EncryptionError);
  });

  it('rejects structurally broken envelopes', () => {
    const k = key();
    expect(() => decryptString('v1:!!!', { key: k })).toThrow(/malformed/);
    expect(() => decryptString(`v1:${Buffer.alloc(20).toString('base64')}`, { key: k })).toThrow(
      /malformed/,
    );
  });

  it('rejects unknown envelope versions (rotation hook)', () => {
    expect(() => decryptString('v2:AAAAAAAA', { key: key() })).toThrow(/unsupported envelope version/);
    expect(() => decryptString('no-colon-at-all', { key: key() })).toThrow(/unsupported envelope version/);
  });

  it('refuses non-string plaintext', () => {
    expect(() => encryptString({ a: 1 } as unknown as string, { key: key() })).toThrow(
      EncryptionError,
    );
  });
});

describe('context / AAD binding', () => {
  const key = () => randomBytes(32);

  it('decrypts with the same context', () => {
    const k = key();
    const env = encryptString('asthma', { key: k, context: 'member:m-42' });
    expect(decryptString(env, { key: k, context: 'member:m-42' })).toBe('asthma');
  });

  it('fails when the context differs (row-swap defence)', () => {
    const k = key();
    const env = encryptString('asthma', { key: k, context: 'member:m-42' });
    expect(() => decryptString(env, { key: k, context: 'member:m-43' })).toThrow(EncryptionError);
  });

  it('fails when context is dropped at decrypt time', () => {
    const k = key();
    const env = encryptString('asthma', { key: k, context: 'member:m-42' });
    expect(() => decryptString(env, { key: k })).toThrow(EncryptionError);
  });

  it('fails when context is invented at decrypt time', () => {
    const k = key();
    const env = encryptString('asthma', { key: k });
    expect(() => decryptString(env, { key: k, context: 'member:m-42' })).toThrow(EncryptionError);
  });

  it('treats empty-string context as absent', () => {
    const k = key();
    const env = encryptString('asthma', { key: k, context: '' });
    expect(decryptString(env, { key: k })).toBe('asthma');
  });
});

describe('JSON helpers (member_health row payloads)', () => {
  it('round-trips objects and arrays', () => {
    const k = randomBytes(32);
    const value = {
      height_cm: 165,
      weight_kg: 62,
      conditions: ['asthma', 'type_2_diabetes'],
      allergies: [{ allergen: 'peanut', severity: 'severe' }],
    };
    const env = encryptJson(value, { key: k, context: 'member:m-1' });
    expect(decryptJson(env, { key: k, context: 'member:m-1' })).toEqual(value);
  });

  it('refuses non-serializable values', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(() => encryptJson(circular, { key: randomBytes(32) })).toThrow(EncryptionError);
    expect(() => encryptJson(undefined, { key: randomBytes(32) })).toThrow(EncryptionError);
  });
});

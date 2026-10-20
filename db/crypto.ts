/**
 * OneTable — app-level encryption for health tables (NF-P1 / NF-P2).
 * AES-256-GCM, key from ENCRYPTION_KEY (32 bytes, base64).
 *
 * Blob format: base64( iv[12] | tag[16] | ciphertext ).
 * WP-0.4 owns the canonical, fully-tested crypto helper (its acceptance
 * criteria: "encryption helper with tests"); this minimal version exists so
 * WP-0.2 can ship an encrypted seed and a round-trip test today. When WP-0.4
 * lands, `lib/crypto.ts` replaces this file and this module re-exports it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { MemberHealthData } from './schema.js';

const IV_LEN = 12;
const TAG_LEN = 16;

export function loadKey(env: Record<string, string | undefined> = process.env): Buffer {
  const raw = env.ENCRYPTION_KEY;
  if (!raw) throw new Error('ENCRYPTION_KEY is not set (32-byte base64 key; see .env.example)');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(
      `ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}. Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/** Encrypt any JSON value to the blob format above. */
export function encryptJson(value: unknown, key: Buffer = loadKey()): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/** Decrypt a blob produced by encryptJson. Throws on tamper (GCM auth). */
export function decryptJson<T = unknown>(blob: string, key: Buffer = loadKey()): T {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('encrypted blob too short');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}

export const encryptHealth = (data: MemberHealthData, key: Buffer = loadKey()): string =>
  encryptJson(data, key);
export const decryptHealth = (blob: string, key: Buffer = loadKey()): MemberHealthData =>
  decryptJson<MemberHealthData>(blob, key);

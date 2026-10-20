// lib/crypto/encryption.ts — application-level AES-256-GCM field encryption
// (NF-P1: "Health data … encrypted at the application level (AES-256-GCM, key
// from env/secret store, never in the repo)"). Owned by WP-0.4; consumed by
// WP-1.3 for the member_health tables.
//
// Envelope format:  v1:<base64( iv(12) ‖ ciphertext ‖ authTag(16) )>
//   • Fresh 12-byte random IV per encryption (GCM never reuses an IV with the
//     same key — two encryptions of the same value produce different output).
//   • The 16-byte GCM tag authenticates iv+ct, so tampering fails loudly.
//   • An optional `context` string is bound as Additional Authenticated Data.
//     Recommended for health rows: context = `member:<memberId>` — ciphertext
//     copied to another row then fails to decrypt even with the right key.
//   • The `v1:` prefix is the key-rotation / algorithm-migration hook: a future
//     WP can add v2 read support and re-encrypt lazily on write.
//
// Never log plaintexts, keys, or full envelopes (NF-P6).
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce length
const TAG_BYTES = 16; // GCM auth tag
const CURRENT_VERSION = 'v1';
const ENV_VAR = 'ENCRYPTION_KEY';

/** All failures are this one type so callers can catch encryption problems
 * without string-matching node's crypto error codes. Messages never contain
 * plaintext, key material, or token values. */
export class EncryptionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'EncryptionError';
  }
}

export interface EnvelopeOptions {
  /**
   * Additional Authenticated Data. Decrypting requires the exact same context.
   * Use a stable row identity, e.g. `member:${memberId}`.
   */
  context?: string;
  /** Override key (tests / rotation). Defaults to ENCRYPTION_KEY from env. */
  key?: Buffer;
}

/** Parse the env value: strict canonical base64 decoding to exactly 32 bytes. */
export function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (trimmed === '') {
    throw new EncryptionError(
      `${ENV_VAR} is empty. Generate one with: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(trimmed, 'base64');
  } catch {
    decoded = Buffer.alloc(0);
  }
  // Canonical check: re-encoding must reproduce the input — catches truncated
  // or hand-mangled keys that Buffer.from silently ignores past the last
  // full quartet.
  if (decoded.length !== KEY_BYTES || decoded.toString('base64') !== trimmed) {
    throw new EncryptionError(
      `${ENV_VAR} must be standard base64 of exactly ${KEY_BYTES} random bytes ` +
        `(got ${decoded.length === KEY_BYTES ? 'non-canonical base64' : `base64 decoding to ${decoded.length} bytes`}). ` +
        'Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return decoded;
}

/** Load and validate the key from the environment (no cache). */
export function loadKeyFromEnv(): Buffer {
  const raw = process.env[ENV_VAR];
  if (raw === undefined) {
    throw new EncryptionError(
      `${ENV_VAR} is not set (NF-P1: key comes from env/secret store, never the repo). ` +
        'Generate one with: node -e "console.log(require(\'node:crypto\').randomBytes(32).toString(\'base64\'))"',
    );
  }
  return parseKey(raw);
}

let cachedKey: Buffer | null = null;

/** Process-cached key getter used when no explicit `key` option is passed. */
export function getEncryptionKey(): Buffer {
  if (!cachedKey) cachedKey = loadKeyFromEnv();
  return cachedKey;
}

/** Test hook — drop the cached key after changing process.env. */
export function resetEncryptionKeyCache(): void {
  cachedKey = null;
}

function aadBuffer(context: string | undefined): Buffer | undefined {
  if (context === undefined || context === '') return undefined;
  return Buffer.from(context, 'utf8');
}

/** Encrypt a UTF-8 string into a `v1:…` envelope. */
export function encryptString(plaintext: string, opts: EnvelopeOptions = {}): string {
  if (typeof plaintext !== 'string') {
    throw new EncryptionError('encryptString expects a string (use encryptJson for objects)');
  }
  const key = opts.key ?? getEncryptionKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const aad = aadBuffer(opts.context);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${CURRENT_VERSION}:${Buffer.concat([iv, ciphertext, tag]).toString('base64')}`;
}

/** Decrypt a `v1:…` envelope. Throws EncryptionError on any auth failure. */
export function decryptString(envelope: string, opts: EnvelopeOptions = {}): string {
  if (typeof envelope !== 'string') {
    throw new EncryptionError('decryptString expects the stored envelope string');
  }
  const sep = envelope.indexOf(':');
  const version = sep === -1 ? '' : envelope.slice(0, sep);
  const body = sep === -1 ? envelope : envelope.slice(sep + 1);
  if (version !== CURRENT_VERSION) {
    throw new EncryptionError(
      `unsupported envelope version "${version || '(none)'}" — this build reads "${CURRENT_VERSION}" (version rotation is a later WP)`,
    );
  }
  const raw = Buffer.from(body, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new EncryptionError('malformed envelope: shorter than iv+tag');
  }
  const key = opts.key ?? getEncryptionKey();
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(raw.length - TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES, raw.length - TAG_BYTES);
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const aad = aadBuffer(opts.context);
    if (aad) decipher.setAAD(aad);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (cause) {
    // Deliberately uninformative detail-wise: never echo plaintext or key state.
    throw new EncryptionError(
      'decryption failed: wrong key, wrong context, or tampered ciphertext',
      { cause },
    );
  }
}

/** Encrypt any JSON-serializable value (object arrays for member_health, …). */
export function encryptJson(value: unknown, opts: EnvelopeOptions = {}): string {
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (cause) {
    throw new EncryptionError('encryptJson: value is not JSON-serializable', { cause });
  }
  if (text === undefined) {
    throw new EncryptionError('encryptJson: value is not JSON-serializable (undefined)');
  }
  return encryptString(text, opts);
}

export function decryptJson<T = unknown>(envelope: string, opts: EnvelopeOptions = {}): T {
  const text = decryptString(envelope, opts);
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new EncryptionError('decryptJson: plaintext is not valid JSON', { cause });
  }
}

import crypto from 'node:crypto';

/**
 * DATABASE_SCHEMA.md §6.1 models `phone_enc` / `address_enc` as BYTEA
 * encrypted with pgcrypto, and `phone_hash` as a deterministic hash for
 * exact lookup without decryption.
 *
 * Strapi has no native BYTEA/pgcrypto field type, so encryption happens in
 * application code instead of in SQL: AES-256-GCM for the reversible fields,
 * HMAC-SHA256 for the deterministic lookup hash. Ciphertext is stored as
 * base64 text (see customer/schema.json `phone_enc` / `address_enc`).
 *
 * Keys are read once from env and MUST be 32-byte secrets (see .env.example).
 * Never commit real keys; rotate via a re-encryption migration if they change.
 */

function requireKey(envVar: string): Buffer {
  const raw = process.env[envVar];
  if (!raw) {
    throw new Error(`${envVar} is not set — required to encrypt/decrypt customer PII`);
  }
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) {
    throw new Error(`${envVar} must decode to exactly 32 bytes (64 hex chars) for AES-256`);
  }
  return key;
}

export function encryptField(plaintext: string): string {
  const key = requireKey('CUSTOMER_PII_ENC_KEY');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
}

export function decryptField(payloadBase64: string): string {
  const key = requireKey('CUSTOMER_PII_ENC_KEY');
  const buf = Buffer.from(payloadBase64, 'base64');
  const iv = buf.subarray(0, 12);
  const authTag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

/** Rule WA-1: phone MUST be normalised to E.164 (91XXXXXXXXXX) before use. Returns null if invalid. */
export function normalizePhoneE164(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return digits;
  if (digits.length === 13 && digits.startsWith('091')) return `91${digits.slice(3)}`;
  return null;
}

export function hashPhone(e164Phone: string): string {
  const key = requireKey('CUSTOMER_PII_HMAC_KEY');
  return crypto.createHmac('sha256', key).update(e164Phone).digest('hex');
}

export function last4(e164Phone: string): string {
  return e164Phone.slice(-4);
}

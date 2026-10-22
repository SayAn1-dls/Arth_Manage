import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/** Parses a 32-byte key given as 64 hex characters or base64. Returns null when absent or malformed. */
export function parseKey(raw: string | undefined): Buffer | null {
  if (!raw) return null;
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  return buf.length === 32 ? buf : null;
}

/** AES-256-GCM. Output is `iv.tag.ciphertext`, each base64, so a tampered value fails to decrypt. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.');
}

export function decryptSecret(blob: string, key: Buffer): string {
  const [iv, tag, body] = blob.split('.').map((p) => Buffer.from(p ?? '', 'base64'));
  if (!iv || !tag || !body) throw new Error('Malformed encrypted value');
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(body), d.final()]).toString('utf8');
}

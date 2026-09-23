import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scrypt as scryptCb } from 'crypto';

/**
 * End-to-end encryption for Shipyard Cloud.
 *
 * The password never leaves this machine. scrypt turns it into a master key,
 * and HKDF splits that in two: `authKey` is what the server checks at login,
 * `kek` wraps the random data key that encrypts every record. The server keeps
 * the wrapped data key — so a second machine can unwrap it with the same
 * password — but has no way to open it.
 */

export interface KdfParams {
  name: 'scrypt';
  N: number;
  r: number;
  p: number;
}

function scrypt(password: string, salt: Buffer, params: KdfParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, 64, { N: params.N, r: params.r, p: params.p, maxmem: 256 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key));
  });
}

export async function deriveKeys(password: string, kdfSalt: string, params: KdfParams): Promise<{ authKey: string; kek: Buffer }> {
  const master = await scrypt(password, Buffer.from(kdfSalt, 'base64'), params);
  const authKey = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'shipyard-auth', 32)).toString('base64');
  const kek = Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), 'shipyard-kek', 32));
  return { authKey, kek };
}

export function newSalt(): string {
  return randomBytes(16).toString('base64');
}

export function newDataKey(): Buffer {
  return randomBytes(32);
}

/** AES-256-GCM, packed as base64(iv | tag | ciphertext). `aad` binds the blob to its record key. */
export function seal(key: Buffer, plain: Buffer, aad?: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function open(key: Buffer, sealed: string, aad?: string): Buffer {
  const buf = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  if (aad) decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
}

export function encryptRecord(dataKey: Buffer, key: string, data: unknown): string {
  return seal(dataKey, Buffer.from(JSON.stringify(data)), key);
}

export function decryptRecord(dataKey: Buffer, key: string, payload: string): unknown {
  return JSON.parse(open(dataKey, payload, key).toString('utf-8'));
}

/** JSON with sorted keys, so the same data always hashes the same. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}

export function hashData(data: unknown): string {
  return createHash('sha1').update(stable(data)).digest('base64');
}

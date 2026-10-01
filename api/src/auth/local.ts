import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const PARAMS = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = 'sig_session';
export const SESSION_TTL_MS = 8 * 60 * 60_000;

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, PARAMS);
  return `scrypt$${PARAMS.N}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, salt, hash] = stored.split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { ...PARAMS, N: Number(n) });
  return crypto.timingSafeEqual(actual, expected);
}

/** Rules shown in the UI too; keep in sync with admin/src/lib/password.ts. */
export function passwordProblems(pw: string): string | null {
  if (pw.length < 12) return 'Use at least 12 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  if (!/[a-zA-Z]/.test(pw) || !/[^a-zA-Z]/.test(pw)) return 'Mix letters with numbers or symbols.';
  return null;
}

export function newSessionId(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** Session IDs are stored hashed so a leaked DB file can't be replayed as cookies. */
export function hashSessionId(id: string, key: Buffer): string {
  return crypto.createHmac('sha256', key).update(id).digest('base64url');
}

export function newSetupToken(): string {
  // Grouped for easy reading from `docker logs`.
  const raw = crypto.randomBytes(12).toString('hex').toUpperCase();
  return raw.match(/.{4}/g)!.join('-');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

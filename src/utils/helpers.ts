import crypto from 'crypto';
import { promisify } from 'util';

// promisify only captures scrypt's 3-arg overload, so type the options form explicitly.
const scryptAsync = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

export const generateId = (prefix: string): string => {
  return `${prefix}-${crypto.randomUUID().split('-')[0]}-${Date.now().toString(36)}`;
};

// ─── Password (PIN) hashing ──────────────────────────────────────────────────
// At rest, PINs are stored as SALTED scrypt. The stored string is self-describing:
//   scrypt$N$r$p$<saltHex>$<hashHex>
// so cost parameters can be bumped later without breaking existing hashes.
//
// The scrypt INPUT is always sha256(pin) (see hashPassword). We keep that sha256
// layer because the mobile app pre-hashes the PIN client-side for the change-PIN
// flow, so every server path — login (raw PIN), register (raw PIN), change-PIN
// (client sha256) and the one-time migration (the value already in the column) —
// converges on the same sha256(pin) credential before scrypt is applied. This is
// what lets the migration re-wrap existing rows WITHOUT anyone's raw PIN.

const SCRYPT_PREFIX = 'scrypt';
const SCRYPT_N = 16384; // CPU/memory cost (2^14)
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 64;

const scryptMaxmem = (N: number, r: number) => 128 * N * r * 2;

/**
 * SHA-256 of the raw PIN. This is the "credential" — NOT the at-rest hash.
 * It is wrapped in salted scrypt by hashPin() before storage.
 */
export const hashPassword = async (password: string): Promise<string> => {
  return crypto.createHash('sha256').update(password).digest('hex');
};

/** True if a stored value is in the salted-scrypt format (vs a legacy bare sha256). */
export const isScryptHash = (stored: unknown): boolean =>
  typeof stored === 'string' && stored.startsWith(SCRYPT_PREFIX + '$');

/**
 * Wrap a sha256(pin) credential in salted scrypt for storage.
 * @param sha256Credential hex output of hashPassword() (or a value already stored as bare sha256)
 */
export const hashPin = async (sha256Credential: string): Promise<string> => {
  const salt = crypto.randomBytes(16);
  const derived = (await scryptAsync(sha256Credential, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: scryptMaxmem(SCRYPT_N, SCRYPT_R),
  })) as Buffer;
  return `${SCRYPT_PREFIX}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${derived.toString('hex')}`;
};

/**
 * Verify a sha256(pin) credential against a stored salted-scrypt hash. Timing-safe.
 * Returns false for any malformed or non-scrypt stored value.
 */
export const verifyPin = async (sha256Credential: string, stored: string): Promise<boolean> => {
  if (!isScryptHash(stored)) return false;
  const parts = stored.split('$'); // [scrypt, N, r, p, saltHex, hashHex]
  if (parts.length !== 6) return false;
  const N = parseInt(parts[1], 10);
  const r = parseInt(parts[2], 10);
  const p = parseInt(parts[3], 10);
  const salt = Buffer.from(parts[4], 'hex');
  const expected = Buffer.from(parts[5], 'hex');
  if (!N || !r || !p || salt.length === 0 || expected.length === 0) return false;
  const derived = (await scryptAsync(sha256Credential, salt, expected.length, {
    N,
    r,
    p,
    maxmem: scryptMaxmem(N, r),
  })) as Buffer;
  return crypto.timingSafeEqual(derived, expected);
};

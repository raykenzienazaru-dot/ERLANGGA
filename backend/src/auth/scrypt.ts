import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/**
 * Versioned scrypt password hashing specification:
 * Format: $scrypt$v=1$N=16384,r=8,p=1$keylen=32$<salt_hex>$<hash_hex>
 *
 * Parameters:
 * - N (cost): 16384 (2^14)
 * - r (blockSize): 8
 * - p (parallelization): 1
 * - keylen: 32 bytes (256-bit derived key)
 * - salt: 16 bytes cryptographically random entropy (32 hex characters)
 * - maxmem: 32 MiB memory limit
 */
const SCRYPT_PREFIX = '$scrypt$v=1$N=16384,r=8,p=1$keylen=32$';
const EXPECTED_SALT_BYTES = 16;
const EXPECTED_HASH_BYTES = 32;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

/**
 * Derives a versioned scrypt hash from a plaintext password using a cryptographically random salt.
 */
export function hashPassword(password: string): string {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = randomBytes(EXPECTED_SALT_BYTES);
  const derivedKey = scryptSync(password, salt, EXPECTED_HASH_BYTES, SCRYPT_OPTIONS);
  return `${SCRYPT_PREFIX}${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

/**
 * Verifies a plaintext password against a formatted scrypt hash in constant time.
 * Returns false safely if the hash format is malformed or invalid without throwing.
 */
export function verifyPassword(password: string, formattedHash: string): boolean {
  if (typeof password !== 'string' || typeof formattedHash !== 'string') {
    return false;
  }
  if (!formattedHash.startsWith(SCRYPT_PREFIX)) {
    return false;
  }

  const remainder = formattedHash.slice(SCRYPT_PREFIX.length);
  const parts = remainder.split('$');
  if (parts.length !== 2) {
    return false;
  }

  const [saltHex, hashHex] = parts;
  if (saltHex.length !== EXPECTED_SALT_BYTES * 2 || hashHex.length !== EXPECTED_HASH_BYTES * 2) {
    return false;
  }

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expectedHash = Buffer.from(hashHex, 'hex');

    if (salt.length !== EXPECTED_SALT_BYTES || expectedHash.length !== EXPECTED_HASH_BYTES) {
      return false;
    }

    const computedHash = scryptSync(password, salt, EXPECTED_HASH_BYTES, SCRYPT_OPTIONS);
    return timingSafeEqual(computedHash, expectedHash);
  } catch {
    return false;
  }
}

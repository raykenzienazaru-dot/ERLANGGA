import { createHmac, timingSafeEqual } from 'node:crypto';
import type { OperatorAccount } from './accountStore.ts';
import { findOperatorById } from './accountStore.ts';

export interface OperatorTokenPayload {
  sub: string;
  username: string;
  role: 'OPERATOR';
  tv: number;
  iat: number;
  exp: number;
}

const JWT_HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

/**
 * Signs an HMAC-SHA256 bearer token for an active operator.
 */
export function signOperatorToken(
  operator: OperatorAccount,
  secret: string,
  expiresInSec: number,
  nowSec: number = Math.floor(Date.now() / 1000)
): string {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Signing secret must be at least 16 characters');
  }

  const payload: OperatorTokenPayload = {
    sub: operator.id,
    username: operator.username,
    role: 'OPERATOR',
    tv: operator.tokenVersion,
    iat: nowSec,
    exp: nowSec + expiresInSec,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(`${JWT_HEADER}.${payloadB64}`)
    .digest('base64url');

  return `${JWT_HEADER}.${payloadB64}.${signature}`;
}

/**
 * Cryptographically verifies an operator bearer token, checking signature,
 * absolute expiration, account active status, and token version match.
 * Returns the decoded token payload or null if invalid, expired, or revoked.
 */
export function verifyOperatorToken(
  token: string,
  secret: string,
  store: Map<string, OperatorAccount>,
  nowSec: number = Math.floor(Date.now() / 1000)
): OperatorTokenPayload | null {
  if (typeof token !== 'string' || typeof secret !== 'string' || secret.length < 16) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  if (headerB64 !== JWT_HEADER) {
    return null;
  }

  // 1. Verify cryptographic signature
  try {
    const expectedSignature = createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');

    const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
    const providedBuf = Buffer.from(signatureB64, 'utf-8');

    if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
      return null;
    }
  } catch {
    return null;
  }

  // 2. Decode and parse payload safely
  let payload: OperatorTokenPayload;
  try {
    const raw = Buffer.from(payloadB64, 'base64url').toString('utf-8');
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.sub !== 'string' ||
    typeof payload.username !== 'string' ||
    payload.role !== 'OPERATOR' ||
    typeof payload.tv !== 'number' ||
    typeof payload.iat !== 'number' ||
    typeof payload.exp !== 'number'
  ) {
    return null;
  }

  // 3. Check absolute expiration
  if (payload.exp <= nowSec) {
    return null;
  }

  // 4. Server-enforced account status & token version verification
  const account = findOperatorById(store, payload.sub);
  if (!account || account.status !== 'ACTIVE' || account.tokenVersion !== payload.tv) {
    return null;
  }

  return payload;
}

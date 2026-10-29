import { verifyPassword } from './scrypt.ts';

export interface OperatorAccount {
  id: string;
  username: string;
  displayName: string;
  role: 'OPERATOR';
  passwordHash: string;
  status: 'ACTIVE' | 'DISABLED';
  tokenVersion: number;
}

/**
 * Validates and loads operator account records from a JSON string.
 * Returns an in-memory Map keyed by normalized username.
 * If input is missing or malformed, returns an empty map safely without throwing.
 */
export function loadAccountStore(rawJson?: string): Map<string, OperatorAccount> {
  const store = new Map<string, OperatorAccount>();
  if (!rawJson || typeof rawJson !== 'string' || rawJson.trim() === '') {
    return store;
  }

  try {
    const parsed = JSON.parse(rawJson);
    if (!Array.isArray(parsed)) {
      return store;
    }

    for (const item of parsed) {
      if (
        typeof item === 'object' &&
        item !== null &&
        typeof item.id === 'string' &&
        item.id.trim() !== '' &&
        typeof item.username === 'string' &&
        item.username.trim() !== '' &&
        typeof item.displayName === 'string' &&
        item.role === 'OPERATOR' &&
        typeof item.passwordHash === 'string' &&
        (item.status === 'ACTIVE' || item.status === 'DISABLED') &&
        typeof item.tokenVersion === 'number' &&
        Number.isInteger(item.tokenVersion) &&
        item.tokenVersion >= 1
      ) {
        const normalizedUsername = item.username.trim().toLowerCase();
        store.set(normalizedUsername, {
          id: item.id.trim(),
          username: normalizedUsername,
          displayName: item.displayName.trim(),
          role: 'OPERATOR',
          passwordHash: item.passwordHash.trim(),
          status: item.status,
          tokenVersion: item.tokenVersion,
        });
      }
    }
  } catch {
    // Malformed JSON is rejected safely; returns empty store
  }

  return store;
}

/**
 * Constant dummy hash used to equalize timing when verifying a non-existent username,
 * preventing username enumeration via response latency differences.
 */
const DUMMY_SCRYPT_HASH =
  '$scrypt$v=1$N=16384,r=8,p=1$keylen=32$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000';

/**
 * Authenticates an operator by username and password.
 * Performs constant-time password verification even if username is invalid.
 * Returns the OperatorAccount if valid and ACTIVE, or null otherwise.
 */
export function authenticateOperator(
  store: Map<string, OperatorAccount>,
  username: string,
  password: string
): OperatorAccount | null {
  const normalized = typeof username === 'string' ? username.trim().toLowerCase() : '';
  const account = store.get(normalized);

  const targetHash = account ? account.passwordHash : DUMMY_SCRYPT_HASH;
  const isPasswordValid = verifyPassword(password, targetHash);

  if (!account || !isPasswordValid) {
    return null;
  }

  if (account.status !== 'ACTIVE') {
    return null;
  }

  return account;
}

/**
 * Finds an operator in the store by operator ID.
 */
export function findOperatorById(
  store: Map<string, OperatorAccount>,
  operatorId: string
): OperatorAccount | undefined {
  for (const account of store.values()) {
    if (account.id === operatorId) {
      return account;
    }
  }
  return undefined;
}

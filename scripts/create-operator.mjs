#!/usr/bin/env node
/**
 * Offline Operator Account Generation Script
 *
 * Generates an operator record with a versioned scrypt password hash
 * for inclusion in the OPERATOR_ACCOUNTS_JSON environment variable.
 *
 * Zero network dependencies. Does not communicate with any broker or external service.
 *
 * Usage:
 *   node scripts/create-operator.mjs <username> <displayName> <password>
 * Example:
 *   node scripts/create-operator.mjs arif "Arif Operator" "CorrectHorseBatteryStaple#2026"
 */

import { randomBytes, randomUUID, scryptSync } from 'node:crypto';

const SCRYPT_PREFIX = '$scrypt$v=1$N=16384,r=8,p=1$keylen=32$';
const EXPECTED_SALT_BYTES = 16;
const EXPECTED_HASH_BYTES = 32;
const SCRYPT_OPTIONS = {
  N: 16384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
};

function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string');
  }
  const salt = randomBytes(EXPECTED_SALT_BYTES);
  const derivedKey = scryptSync(password, salt, EXPECTED_HASH_BYTES, SCRYPT_OPTIONS);
  return `${SCRYPT_PREFIX}${salt.toString('hex')}$${derivedKey.toString('hex')}`;
}

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error('Usage: node scripts/create-operator.mjs <username> <displayName> <password>');
  process.exit(1);
}

const [rawUsername, displayName, password] = args;
const username = rawUsername.trim().toLowerCase();

if (password.length < 12) {
  console.warn('Warning: Password is shorter than 12 characters. Strong passphrases are recommended.');
}

const passwordHash = hashPassword(password);
const id = `op_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

const record = {
  id,
  username,
  displayName: displayName.trim(),
  role: 'OPERATOR',
  passwordHash,
  status: 'ACTIVE',
  tokenVersion: 1,
};

console.log('\n--- Operator Account JSON Entry ---');
console.log(JSON.stringify(record, null, 2));
console.log('\nTo configure this account in Railway or your local .env, add it to the OPERATOR_ACCOUNTS_JSON array:');
console.log(`OPERATOR_ACCOUNTS_JSON='${JSON.stringify([record])}'\n`);

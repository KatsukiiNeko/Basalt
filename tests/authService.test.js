// Service-level tests for the auth flows LockScreen and PasswordManager use.
// All crypto runs at a fast iteration count; production constants stay
// pinned by tests/crypto.test.js.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import {
  deriveKey,
  generateSalt,
  createVerificationToken,
  encryptTransactionForStorage,
  decryptTransactionFromStorage,
  clearAllSessionKeys,
  getSessionKey,
} from '../src/crypto/crypto';
import {
  fetchAccountAuthState,
  unlockAttempt,
  setupPassword,
  changePassword,
  upgradePbkdf2,
} from '../src/services/auth';

const ACCT = 'auth-test-account';
const FAST = 1000;

async function seedVault(password, iterations = FAST) {
  const salt = generateSalt();
  const key = await deriveKey(password, salt, iterations);
  const token = await createVerificationToken(key);
  await db.settings.bulkPut([
    { key: 'salt:' + ACCT, value: Array.from(salt) },
    { key: 'verificationToken:' + ACCT, value: token },
    { key: 'passwordSet:' + ACCT, value: true },
    { key: 'pbkdf2Version:' + ACCT, value: iterations },
  ]);
  return { salt, key, token };
}

async function addRow(tx, key) {
  const enc = await encryptTransactionForStorage(tx, key);
  enc.accountId = ACCT;
  return db.transactions.add(enc);
}

const TX = { date: '2026-03-01', type: 'expense', category: 'Food & Dining', amount: 800 };

beforeEach(async () => {
  await db.transactions.clear();
  await db.settings.clear();
  clearAllSessionKeys();
});

describe('fetchAccountAuthState', () => {
  it('reports first-time when no password was ever set', async () => {
    const state = await fetchAccountAuthState(ACCT);
    expect(state.isFirstTime).toBe(true);
    expect(state.storedIterations).toBe(200000); // legacy default
  });

  it('reads back the persisted iteration version', async () => {
    await seedVault('pw', 600000);
    const state = await fetchAccountAuthState(ACCT);
    expect(state.isFirstTime).toBe(false);
    expect(state.storedIterations).toBe(600000);
  });
});

describe('unlockAttempt', () => {
  it('accepts the correct password and returns a usable key', async () => {
    const { key } = await seedVault('correct-horse');
    const attempt = await unlockAttempt(ACCT, 'correct-horse');
    expect(attempt.isValid).toBe(true);
    // CryptoKey objects are not comparable; prove usability by decrypting.
    const id = await addRow(TX, key);
    const row = await db.transactions.get(id);
    const plain = await decryptTransactionFromStorage(row, attempt.key);
    expect(plain.amount).toBe(800);
  });

  it('rejects a wrong password', async () => {
    await seedVault('correct-horse');
    const attempt = await unlockAttempt(ACCT, 'wrong');
    expect(attempt.isValid).toBe(false);
  });

  it('throws CORRUPTED when the salt is missing', async () => {
    await db.settings.put({ key: 'passwordSet:' + ACCT, value: true });
    await expect(unlockAttempt(ACCT, 'x')).rejects.toThrow('CORRUPTED');
  });

  it('throws TOKEN_MISSING when the verification token is absent', async () => {
    const salt = generateSalt();
    await db.settings.bulkPut([
      { key: 'salt:' + ACCT, value: Array.from(salt) },
      { key: 'passwordSet:' + ACCT, value: true },
    ]);
    await expect(unlockAttempt(ACCT, 'x')).rejects.toThrow('TOKEN_MISSING');
  });
});

describe('setupPassword', () => {
  it('creates verifiable auth state and registers the session key', async () => {
    await setupPassword(ACCT, 'brand-new', { iterations: FAST });

    const state = await fetchAccountAuthState(ACCT);
    expect(state.isFirstTime).toBe(false);
    expect(state.storedIterations).toBe(FAST);
    expect(getSessionKey(ACCT)).toBeDefined();

    const attempt = await unlockAttempt(ACCT, 'brand-new');
    expect(attempt.isValid).toBe(true);
  });
});
describe('changePassword', () => {
  it('re-encrypts the vault so the new password opens every row', async () => {
    const { key } = await seedVault('old-pass');
    await addRow(TX, key);
    await addRow({ ...TX, date: '2026-03-05', amount: 120 }, key);

    await changePassword(ACCT, 'old-pass', 'new-pass-9', { iterations: FAST });

    // Old password no longer verifies.
    expect((await unlockAttempt(ACCT, 'old-pass')).isValid).toBe(false);
    const after = await unlockAttempt(ACCT, 'new-pass-9');
    expect(after.isValid).toBe(true);

    // Both rows decrypt under the new key.
    const rows = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const plain = await decryptTransactionFromStorage(row, after.key);
      expect(plain.category).toBe('Food & Dining');
    }
  });

  it('refuses to rekey when the current password is wrong', async () => {
    const { key } = await seedVault('right');
    await addRow(TX, key);

    await expect(changePassword(ACCT, 'wrong', 'next', { iterations: FAST }))
      .rejects.toThrow('WRONG_PASSWORD');

    const rows = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(rows).toHaveLength(1);
  });

  it('ABORTS the rekey when a row is undecryptable — never a partial wipe', async () => {
    const { key } = await seedVault('owner');
    await addRow(TX, key);
    // Corrupt row: encrypted with a different key, silently un-decryptable.
    const foreignKey = await deriveKey('foreign', generateSalt(), FAST);
    await addRow({ ...TX, date: '2026-03-09' }, foreignKey);

    await expect(changePassword(ACCT, 'owner', 'next-pass', { iterations: FAST }))
      .rejects.toThrow();

    // The wipe never happened: both rows still exist under the old password.
    const rows = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(rows).toHaveLength(2);
    expect((await unlockAttempt(ACCT, 'owner')).isValid).toBe(true);
  });
});

describe('upgradePbkdf2', () => {
  it('migrates a legacy 200k vault to the new standard and preserves data', async () => {
    const { key } = await seedVault('keep-me', 200000);
    await addRow(TX, key);

    const attempt = await unlockAttempt(ACCT, 'keep-me');
    expect(attempt.storedIterations).toBe(200000);

    await upgradePbkdf2(ACCT, attempt.key, 'keep-me', { iterations: 600000 });

    const state = await fetchAccountAuthState(ACCT);
    expect(state.storedIterations).toBe(600000);

    // The re-encrypted rows decrypt with the NEW 600k key.
    const newAttempt = await unlockAttempt(ACCT, 'keep-me');
    expect(newAttempt.isValid).toBe(true);
    const rows = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(rows).toHaveLength(1);
    const plain = await decryptTransactionFromStorage(rows[0], newAttempt.key);
    expect(plain.amount).toBe(800);
  });
});


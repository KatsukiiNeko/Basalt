// Service-level tests for src/services/auth — the flows LockScreen drives
// (fetchAccountAuthState, unlockAttempt, setupPassword, upgradePbkdf2) and
// PasswordManager drives (changePassword). Most derivation here runs at a
// fast iteration count to keep these quick; tests/crypto.test.js is what
// pins the production constant.
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
    expect(state.storedIterations).toBe(200000); // legacy default, reported before anything is stored
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
    // CryptoKey objects can't be compared, so we prove the returned key is
    // the real one by using it: it opens a row the vault key wrote.
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

    // The old password is dead: rekeyVault swapped in a fresh salt and
    // verification token, so nothing under the old one verifies any more.
    expect((await unlockAttempt(ACCT, 'old-pass')).isValid).toBe(false);
    const after = await unlockAttempt(ACCT, 'new-pass-9');
    expect(after.isValid).toBe(true);

    // The rekey re-wrapped every row, so both still open under the new key.
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
    // Corrupt row: encrypted under a foreign key, so rekeyVault's decrypt
    // pass throws on it.
    const foreignKey = await deriveKey('foreign', generateSalt(), FAST);
    await addRow({ ...TX, date: '2026-03-09' }, foreignKey);

    await expect(changePassword(ACCT, 'owner', 'next-pass', { iterations: FAST }))
      .rejects.toThrow();

    // The wipe never ran: rekeyVault decrypts everything before it deletes
    // anything, so both rows survive under the old password.
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

    // The row was re-wrapped at the new iteration count: the 600k key is
    // the only one that opens it now.
    const newAttempt = await unlockAttempt(ACCT, 'keep-me');
    expect(newAttempt.isValid).toBe(true);
    const rows = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(rows).toHaveLength(1);
    const plain = await decryptTransactionFromStorage(rows[0], newAttempt.key);
    expect(plain.amount).toBe(800);
  });
});


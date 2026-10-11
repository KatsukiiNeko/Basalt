// Our secure-backup lifecycle tests, run against the in-memory IndexedDB
// from tests/setup.js (fake-indexeddb): create -> parse -> restore, the
// failure paths, and the skippedCount corruption-reporting contract that
// DR-0004 defines.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import {
  deriveKey,
  generateSalt,
  setSessionKey,
  clearAllSessionKeys,
  createVerificationToken,
  createSecureBackup,
  parseSecureBackup,
  restoreSecureBackup,
  encryptTransactionForStorage
} from '../src/crypto/crypto';

const ACCOUNT = 'test-account';
const PASSWORD = 'backup-passphrase';

async function seedAccount() {
  await db.accounts.put({ id: ACCOUNT, name: 'Test Account', createdAt: new Date().toISOString() });

  const salt = generateSalt();
  const key = await deriveKey(PASSWORD, salt, 1000);
  setSessionKey(key, ACCOUNT);
  const token = await createVerificationToken(key);
  await db.settings.put({ key: 'salt:' + ACCOUNT, value: Array.from(salt) });
  await db.settings.put({ key: 'verificationToken:' + ACCOUNT, value: token });

  const txs = [
    { date: '2026-01-15', type: 'expense', category: 'Food', amount: 1250000, note: 'lunch' },
    { date: '2026-01-16', type: 'income', category: 'Salary', amount: 30000000, note: '' }
  ];
  for (const tx of txs) {
    const enc = await encryptTransactionForStorage(tx, key);
    await db.transactions.add({ ...enc, accountId: ACCOUNT });
  }
}

beforeEach(async () => {
  await Promise.all([db.transactions.clear(), db.settings.clear(), db.accounts.clear()]);
  clearAllSessionKeys();
});

describe('createSecureBackup / parseSecureBackup / restoreSecureBackup round-trip', () => {
  it('restores the exact transactions that were backed up', async () => {
    await seedAccount();

    const backup = await createSecureBackup('strong-backup-pw', ACCOUNT);
    expect(backup.version).toBe(3);
    expect(backup.algorithm).toBe('AES-GCM-256');
    expect(backup.skippedCount).toBe(0);

    const parsed = await parseSecureBackup(backup);
    expect(parsed.accountName).toBe('Test Account');

    const restoredCount = await restoreSecureBackup(backup, 'strong-backup-pw', ACCOUNT);
    expect(restoredCount).toBe(2);

    const rows = await db.transactions.where('accountId').equals(ACCOUNT).toArray();
    expect(rows).toHaveLength(2);

    // Restore re-wraps every row under the *session* key, so it is this
    // session — not the backup password — that reads them back.
    const { decryptTransactionFromStorage, getSessionKey } = await import('../src/crypto/crypto');
    const plain = await decryptTransactionFromStorage(rows[0], getSessionKey(ACCOUNT));
    expect(plain.amount).toBe(1250000);
  });

  it('rejects restore with the wrong backup password', async () => {
    await seedAccount();
    const backup = await createSecureBackup('right-password', ACCOUNT);
    await expect(restoreSecureBackup(backup, 'wrong-password!', ACCOUNT)).rejects.toThrow(
      'Wrong password or corrupted backup'
    );
  });

  it('rejects short passwords on both create and restore', async () => {
    await seedAccount();
    await expect(createSecureBackup('abc', ACCOUNT)).rejects.toThrow('at least 4 characters');
    const backup = await createSecureBackup('good-password', ACCOUNT);
    await expect(restoreSecureBackup(backup, 'abc', ACCOUNT)).rejects.toThrow('at least 4 characters');
  });

  it('throws Session expired when no session key exists', async () => {
    await seedAccount();
    clearAllSessionKeys();
    await expect(createSecureBackup('good-password', ACCOUNT)).rejects.toThrow('Session expired');
  });
});

describe('createSecureBackup skippedCount contract (DR-0004)', () => {
  it('counts undecryptable rows in metadata instead of aborting or staying silent', async () => {
    await seedAccount();
    // We hand createSecureBackup a row whose ciphertext the account key
    // never produced — a corrupted record. Decryption throws on it inside
    // the backup loop, which DR-0004 says to count, not to abort on.
    await db.transactions.add({
      iv: [1, 2, 3],
      data: [9, 9, 9, 9],
      accountId: ACCOUNT
    });

    const backup = await createSecureBackup('good-password', ACCOUNT);
    expect(backup.skippedCount).toBe(1);

    // The corrupt row never made it into the payload, so restore lays down
    // only the two good rows.
    const restored = await restoreSecureBackup(backup, 'good-password', ACCOUNT);
    expect(restored).toBe(2);
  });
});

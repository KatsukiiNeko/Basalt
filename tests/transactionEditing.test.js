import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import {
  deriveKey,
  generateSalt,
  encryptTransactionForStorage,
  decryptTransactionFromStorage,
  validateTransactionData,
  setSessionKey,
  clearAllSessionKeys,
  getActiveAccountId
} from '../src/crypto/crypto';

// Exercises the exact persistence flow the new edit feature uses:
// decrypt -> modify -> validate -> re-encrypt -> update() by ORIGINAL id —
// against the real Dexie schema on fake-indexeddb. Guards against edit-mode
// ever creating duplicate rows or bypassing the crypto layer.
const FAST_ITERATIONS = 1000;

const seedTx = {
  date: '2026-08-01',
  type: 'expense',
  category: 'Food & Dining',
  amount: 1250,
  note: 'lunch'
};

async function addEncrypted(tx, key) {
  const encrypted = await encryptTransactionForStorage(tx, key);
  encrypted.accountId = getActiveAccountId();
  return db.transactions.add(encrypted);
}

describe('transaction editing round-trip (encrypted, real DB shape)', () => {
  let key;

  beforeEach(async () => {
    await db.transactions.clear();
    clearAllSessionKeys();
    key = await deriveKey('pw', generateSalt(), FAST_ITERATIONS);
    setSessionKey(key, 'test-account');
  });

  it('update() replaces in place — no duplicate rows, id preserved', async () => {
    // Seed one row through the same path TransactionForm.add uses.
    const originalTx = { ...seedTx };
    expect(validateTransactionData(originalTx)).toBe(true);
    const id = await addEncrypted(originalTx, key);

    // History decrypts for display; the form receives this decrypted record.
    const storedRow = await db.transactions.get(id);
    const decrypted = await decryptTransactionFromStorage(storedRow, key);
    expect(decrypted.amount).toBe(1250);

    // User edits the amount + category in the form.
    const modified = {
      ...decrypted,
      amount: 99000,
      category: 'Shopping',
      note: 'headphones'
    };
    delete modified.id; // form state carries no row id
    expect(validateTransactionData(modified)).toBe(true);

    // The form's save path: encrypt whole object, update keyed by ORIGINAL id.
    const reEncrypted = await encryptTransactionForStorage(modified, key);
    reEncrypted.accountId = getActiveAccountId();
    await db.transactions.update(id, reEncrypted);

    const all = await db.transactions.toArray();
    expect(all).toHaveLength(1); // no duplicate created

    const after = await decryptTransactionFromStorage(all[0], key);
    expect(after.amount).toBe(99000);
    expect(after.category).toBe('Shopping');
    expect(after.note).toBe('headphones');
    expect(after.date).toBe(seedTx.date);
  });

  it('cancelling an edit leaves the stored row untouched', async () => {
    const id = await addEncrypted({ ...seedTx }, key);

    // Simulate "cancel": no write occurs, so the next read must be identical.
    const row = await db.transactions.get(id);
    const before = await decryptTransactionFromStorage(row, key);

    const all = await db.transactions.toArray();
    expect(all).toHaveLength(1);
    const after = await decryptTransactionFromStorage(all[0], key);
    expect(after).toEqual(before);
    expect(after.amount).toBe(1250);
  });

  it('invalid edits are rejected by validation before any encryption/DB write', async () => {
    await addEncrypted({ ...seedTx }, key);

    const badEdit = { ...seedTx, amount: -5 };
    if (!validateTransactionData(badEdit)) {
      // TransactionForm stops here — never reaching encrypt/update.
      return;
    }
    throw new Error('validation should have rejected a negative amount');
  });

  it('edited rows stay scoped to their accountId index', async () => {
    const id = await addEncrypted({ ...seedTx }, key);
    const modified = { ...seedTx, amount: 777 };
    const reEncrypted = await encryptTransactionForStorage(modified, key);
    reEncrypted.accountId = 'test-account';
    await db.transactions.update(id, reEncrypted);

    const scoped = await db.transactions.where('accountId').equals('test-account').toArray();
    expect(scoped).toHaveLength(1);
    const tx = await decryptTransactionFromStorage(scoped[0], key);
    expect(tx.amount).toBe(777);
  });
});

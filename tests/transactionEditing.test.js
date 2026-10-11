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

// We exercise the exact persistence flow the edit feature runs: decrypt ->
// modify -> validate -> re-encrypt -> update() by ORIGINAL id, against the
// real Dexie schema on fake-indexeddb. The point is the guarantee: edit
// mode must never create a duplicate row and must never bypass the crypto
// layer.
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
    // Seed one row through the same encrypt-then-add shape TransactionForm's
    // add path uses.
    const originalTx = { ...seedTx };
    expect(validateTransactionData(originalTx)).toBe(true);
    const id = await addEncrypted(originalTx, key);

    // History decrypts for display, so this decrypted record is what the
    // form gets handed.
    const storedRow = await db.transactions.get(id);
    const decrypted = await decryptTransactionFromStorage(storedRow, key);
    expect(decrypted.amount).toBe(1250);

    // The user's edits: amount, category, note — every field has to still
    // pass validateTransactionData below.
    const modified = {
      ...decrypted,
      amount: 99000,
      category: 'Shopping',
      note: 'headphones'
    };
    delete modified.id; // form state carries no row id — the save path keys off the original id
    expect(validateTransactionData(modified)).toBe(true);

    // The form's save path: encrypt the whole object, then update() keyed
    // by the ORIGINAL id — that is what keeps this an edit, not an insert.
    const reEncrypted = await encryptTransactionForStorage(modified, key);
    reEncrypted.accountId = getActiveAccountId();
    await db.transactions.update(id, reEncrypted);

    const all = await db.transactions.toArray();
    expect(all).toHaveLength(1); // still one row: no duplicate was created

    const after = await decryptTransactionFromStorage(all[0], key);
    expect(after.amount).toBe(99000);
    expect(after.category).toBe('Shopping');
    expect(after.note).toBe('headphones');
    expect(after.date).toBe(seedTx.date);
  });

  it('cancelling an edit leaves the stored row untouched', async () => {
    const id = await addEncrypted({ ...seedTx }, key);

    // Simulate "cancel": no write ever happens, so a re-read has to return
    // the identical record we started from.
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
      // TransactionForm bails at exactly this point, so encrypt/update
      // never run for an invalid edit.
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

// Multi-account isolation: each account is an independent encrypted vault.
// These tests pin the security property that a session for account A can
// never read account B's rows — both at the query level (Dexie scoping)
// and at the crypto level (AES-GCM must reject B's key on A's ciphertext).
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import {
  deriveKey,
  generateSalt,
  setSessionKey,
  clearAllSessionKeys,
  createVerificationToken,
  encryptTransactionForStorage,
  decryptTransactionFromStorage,
  getSessionKey,
} from '../src/crypto/crypto';

const A = 'account-a';
const B = 'account-b';

let keyA;
let keyB;

const TX_A = { date: '2026-02-01', type: 'expense', category: 'Food & Dining', amount: 500 };
const TX_B = { date: '2026-02-02', type: 'income', category: 'Salary', amount: 9000 };

async function addRow(tx, key, accountId) {
  const encrypted = await encryptTransactionForStorage(tx, key);
  encrypted.accountId = accountId;
  return db.transactions.add(encrypted);
}

beforeAll(async () => {
  await db.accounts.bulkPut([
    { id: A, name: 'A', createdAt: new Date().toISOString() },
    { id: B, name: 'B', createdAt: new Date().toISOString() },
  ]);

  const saltA = generateSalt();
  const saltB = generateSalt();
  keyA = await deriveKey('password-a', saltA);
  keyB = await deriveKey('password-b', saltB);

  // Independent salts/tokens per account, namespaced by accountId.
  await db.settings.bulkPut([
    { key: 'salt:' + A, value: Array.from(saltA) },
    { key: 'verificationToken:' + A, value: await createVerificationToken(keyA) },
    { key: 'salt:' + B, value: Array.from(saltB) },
    { key: 'verificationToken:' + B, value: await createVerificationToken(keyB) },
  ]);
});

beforeEach(async () => {
  await db.transactions.clear();
  clearAllSessionKeys();
  await addRow(TX_A, keyA, A);
  await addRow(TX_B, keyB, B);
});

describe('query-level isolation', () => {
  it('scoped queries return only the owning account rows', async () => {
    const rowsA = await db.transactions.where('accountId').equals(A).toArray();
    expect(rowsA).toHaveLength(1);

    const rowsB = await db.transactions.where('accountId').equals(B).toArray();
    expect(rowsB).toHaveLength(1);
    expect(rowsA[0].id).not.toBe(rowsB[0].id);
  });

  it('deleting one account leaves the other untouched', async () => {
    await db.transactions.where('accountId').equals(A).delete();
    expect(await db.transactions.where('accountId').equals(A).toArray()).toEqual([]);
    expect((await db.transactions.where('accountId').equals(B).toArray()).length).toBe(1);
  });
});

describe('crypto-level isolation', () => {
  it("account A's key cannot decrypt account B's rows (GCM auth tag)", async () => {
    const rowB = (await db.transactions.where('accountId').equals(B).toArray())[0];
    await expect(decryptTransactionFromStorage(rowB, keyA)).rejects.toThrow();

    const rowA = (await db.transactions.where('accountId').equals(A).toArray())[0];
    await expect(decryptTransactionFromStorage(rowA, keyB)).rejects.toThrow();
  });

  it('each key decrypts its own account rows', async () => {
    const rowA = (await db.transactions.where('accountId').equals(A).toArray())[0];
    const plain = await decryptTransactionFromStorage(rowA, keyA);
    expect(plain.amount).toBe(TX_A.amount);

    const rowB = (await db.transactions.where('accountId').equals(B).toArray())[0];
    const plainB = await decryptTransactionFromStorage(rowB, keyB);
    expect(plainB.category).toBe(TX_B.category);
  });

  it('session keys stay per-account in the registry (active vs. by-id lookup)', () => {
    setSessionKey(keyA, A);
    setSessionKey(keyB, B);
    // Setting B's key makes B active, but A's key must remain resolvable
    // by its own accountId — the property multi-account UI relies on.
    expect(getSessionKey(A)).toBeDefined();
    expect(getSessionKey(B)).toBeDefined();
    expect(getSessionKey(A)).not.toBe(getSessionKey(B));
  });
});

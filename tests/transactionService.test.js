// Service-level tests for src/services/transactions — the layer every UI
// writer hands its plain records to. Runs against real fake-indexeddb, so
// the Dexie accountId scoping and the ciphertext rows are the real thing.
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db/db';
import {
  deriveKey,
  generateSalt,
  setSessionKey,
  clearAllSessionKeys,
  setActiveAccountId,
  encryptTransactionForStorage,
} from '../src/crypto/crypto';
import {
  loadAllDecrypted,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  computeSummary,
} from '../src/services/transactions';

const ACCT = 'svc-test-account';
const FAST = 1000;

const TX = { date: '2026-04-01', type: 'expense', category: 'Food & Dining', amount: 400, note: 'coffee' };

async function seedSession() {
  const key = await deriveKey('pw', generateSalt(), FAST);
  setSessionKey(key, ACCT);
  setActiveAccountId(ACCT);
  return key;
}

beforeEach(async () => {
  await db.transactions.clear();
  await db.settings.clear();
  clearAllSessionKeys();
});

describe('loadAllDecrypted', () => {
  it('returns self-contained records (id AND accountId) and counts corrupt rows', async () => {
    await seedSession();
    await addTransaction(TX, ACCT);

    // We plant a row encrypted under a foreign key: it sits in the table
    // but this session's key can't open it — the corrupt-row case
    // loadAllDecrypted has to count rather than crash on.
    const foreignKey = await deriveKey('other', generateSalt(), FAST);
    const bad = await encryptTransactionForStorage(TX, foreignKey);
    bad.accountId = ACCT;
    await db.transactions.add(bad);

    const { transactions, skippedCount } = await loadAllDecrypted(ACCT);
    expect(transactions).toHaveLength(1);
    expect(skippedCount).toBe(1);
    // The record we hand History's inline editor has to carry both
    // identity fields, so it can go straight back into updateTransaction
    // without us reconstructing anything.
    expect(transactions[0].id).toBeDefined();
    expect(transactions[0].accountId).toBe(ACCT);
    expect(transactions[0].amount).toBe(400);
  });
});

describe('updateTransaction — account-scope preservation', () => {
  it('keeps the row inside its account when the caller omits accountId', async () => {
    await seedSession();
    const id = await addTransaction(TX, ACCT);

    // What History's inline editor hands us: the decrypted record, which
    // carries no accountId (it lives on the encrypted wrapper), and rows
    // written before that flow existed may lack it entirely.
    const { transactions } = await loadAllDecrypted(ACCT);
    const decrypted = transactions[0];
    const stripped = { date: decrypted.date, type: decrypted.type, category: decrypted.category, amount: 999, note: decrypted.note };

    await updateTransaction(id, stripped, undefined);

    const scoped = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(scoped).toHaveLength(1); // the row never dropped out of its scope
    expect(scoped[0].accountId).toBe(ACCT);
    expect(scoped[0].id).toBe(id);   // same row updated in place, not a duplicate
  });

  it('rejects writes claiming a foreign account (no session for it)', async () => {
    await seedSession();
    const id = await addTransaction(TX, ACCT);

    // A stale record pointing at another account must never quietly move
    // the row: we hold no session key for that account, so the write is
    // refused outright and the row keeps its original owner.
    await expect(
      updateTransaction(id, { ...TX, amount: 50 }, 'other-account')
    ).rejects.toThrow();

    const mine = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(mine).toHaveLength(1);
    expect(mine[0].accountId).toBe(ACCT);
  });
});

describe('computeSummary', () => {
  const mk = (date, type, amount) => ({ date, type, category: 'X', amount, accountId: ACCT });

  it('aggregates month and all-time totals plus months-with-data', () => {
    const txs = [
      mk('2026-04-02', 'income', 1000),
      mk('2026-04-05', 'expense', 300),
      mk('2026-03-20', 'expense', 100),
    ];
    const summary = computeSummary(txs, 2026, 3); // months are 0-based: 3 = April

    expect(summary.monthIncome).toBe(1000);
    expect(summary.monthExpenses).toBe(300);
    expect(summary.totalBalance).toBe(600); // all-time income - expenses, not April-only
    expect(summary.monthsWithData.has('2026-04')).toBe(true);
    expect(summary.monthsWithData.has('2026-03')).toBe(true);
    expect(summary.monthsWithData.size).toBe(2);
  });

  it('returns an empty summary for no transactions', () => {
    const summary = computeSummary([], 2026, 0);
    expect(summary.monthIncome).toBe(0);
    expect(summary.monthExpenses).toBe(0);
    expect(summary.totalBalance).toBe(0);
    expect(summary.monthsWithData.size).toBe(0);
  });
});

describe('deleteTransaction', () => {
  it('removes exactly the targeted row', async () => {
    await seedSession();
    const a = await addTransaction(TX, ACCT);
    await addTransaction({ ...TX, date: '2026-04-03' }, ACCT);

    await deleteTransaction(a);

    const rows = await db.transactions.where('accountId').equals(ACCT).toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).not.toBe(a);
  });
});

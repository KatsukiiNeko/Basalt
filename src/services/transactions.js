// Transaction application service: the only layer (besides backupService)
// that touches the transactions table. Components hand over plain records
// and never deal with ciphertext, IVs, or Dexie.
import { db } from '../db/db';
import {
  getSessionKey,
  encryptTransactionForStorage,
  decryptTransactionFromStorage,
  getActiveAccountId,
} from '../crypto/crypto';
import { validateTransactionData } from '../crypto/transactionCrypto';
import { SessionExpiredError } from './errors';

function requireSessionKey(accountId) {
  const key = getSessionKey(accountId);
  if (!key) throw new SessionExpiredError();
  return key;
}

// Callers may omit accountId (History's inline editor passes the decrypted
// record, which has no account field — accountId lives on the encrypted
// wrapper). Falling back to the ACTIVE account is safe here because every
// writer is already session-scoped: getActiveAccountId() is exactly the
// account whose session key requireSessionKey just validated.
function resolveAccountId(accountId) {
  return accountId || getActiveAccountId();
}

export async function loadAllDecrypted(accountId) {
  const key = requireSessionKey(accountId);

  const rows = await db.transactions.where('accountId').equals(accountId).toArray();
  const transactions = [];
  let skippedCount = 0;
  for (const row of rows) {
    try {
      const tx = await decryptTransactionFromStorage(row, key);
      // Self-contained record: consumers (inline editing, forms) can pass
      // it straight back to the update service without reconstruction.
      tx.id = row.id;
      tx.accountId = row.accountId;
      transactions.push(tx);
    } catch {
      // A single corrupt row must not blank the whole vault view, but it
      // must not vanish silently either — count it so the UI can warn.
      skippedCount += 1;
    }
  }
  return { transactions, skippedCount };
}

export async function addTransaction(transaction, accountId) {
  const owner = resolveAccountId(accountId);
  requireSessionKey(owner);
  if (!validateTransactionData(transaction)) {
    throw new Error('Invalid transaction data');
  }
  const encrypted = await encryptTransactionForStorage(transaction, requireSessionKey(owner));
  encrypted.accountId = owner;
  return db.transactions.add(encrypted);
}

export async function updateTransaction(id, transaction, accountId) {
  const owner = resolveAccountId(accountId);
  requireSessionKey(owner);
  if (!validateTransactionData(transaction)) {
    throw new Error('Invalid transaction data');
  }
  const encrypted = await encryptTransactionForStorage(transaction, requireSessionKey(owner));
  // CRITICAL: the row must stay inside its account scope. An undefined
  // accountId here would make the transaction invisible to every scoped
  // query AND to backups while still occupying the database.
  encrypted.accountId = owner;
  encrypted.id = id;
  await db.transactions.update(id, encrypted);
}

export async function deleteTransaction(id) {
  await db.transactions.delete(id);
}

// Pure month/summary aggregation over decrypted transactions. Kept free of
// DB access so month navigation never re-decrypts anything.
export function computeSummary(transactions, year, month) {
  const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;

  let monthIncome = 0;
  let monthExpenses = 0;
  let allTimeIncome = 0;
  let allTimeExpenses = 0;
  const monthsWithData = new Set();

  for (const tx of transactions) {
    if (tx.type === 'income') {
      allTimeIncome += tx.amount;
    } else {
      allTimeExpenses += tx.amount;
    }
    const key = tx.date.slice(0, 7);
    monthsWithData.add(key);
    if (key === monthKey) {
      if (tx.type === 'income') {
        monthIncome += tx.amount;
      } else {
        monthExpenses += tx.amount;
      }
    }
  }

  return {
    monthIncome,
    monthExpenses,
    totalBalance: allTimeIncome - allTimeExpenses,
    monthsWithData,
  };
}

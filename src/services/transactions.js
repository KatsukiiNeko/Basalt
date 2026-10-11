// Our transaction application service: with backupService, the only layer
// that touches the transactions table. Components (TransactionForm,
// History, useVaultData) hand us plain records and never deal with
// ciphertext, IVs, or Dexie themselves.
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

// Callers may omit accountId — the argument is optional — and we fall
// back to the ACTIVE account. That is safe because every writer is
// already session-scoped: getActiveAccountId() is exactly the account
// whose session key requireSessionKey just validated. History's inline
// editor hands us its decrypted record straight back for this call;
// accountId really lives on the encrypted wrapper, and loadAllDecrypted
// copies it onto the record for that hand-back.
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
      // We stamp id and accountId onto the decrypted record so it is
      // self-contained: consumers (inline editing, forms) can pass it
      // straight back to the update service without reconstruction.
      tx.id = row.id;
      tx.accountId = row.accountId;
      transactions.push(tx);
    } catch {
      // One corrupt row must not blank the whole vault view, but it must
      // not vanish silently either — we count it so the UI can warn.
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
  // query AND to backups while still occupying the database — so we stamp
  // `owner` unconditionally, every single time.
  encrypted.accountId = owner;
  encrypted.id = id;
  await db.transactions.update(id, encrypted);
}

export async function deleteTransaction(id) {
  await db.transactions.delete(id);
}

// Pure month/summary aggregation over decrypted transactions: the
// month's income/expense, the all-time balance, and the set of months
// that have data. We keep it free of DB access so month navigation never
// re-decrypts anything — and exportWorkbook reuses it so the exported
// Summary matches the dashboard exactly.
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

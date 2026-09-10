// Backup application service: the UI layer owns file picking/downloads, this
// layer owns everything that touches the DB or crypto. Versioned formats:
//   1 — pre-multi-account array of raw transactions
//   2 — quick backup: session-key-encrypted { transactions, timestamp }
//   3 — secure backup: password-derived key, cross-device portable
import { db } from '../db/db';
import {
  encryptData,
  decryptData,
  generateIV,
  getSessionKey,
} from '../crypto/crypto';

export const QUICK_BACKUP_VERSION = 2;

export function createQuickBackup(accountId) {
  return (async () => {
    const key = getSessionKey(accountId);
    if (!key) throw new Error('SESSION_EXPIRED');

    const rows = await db.transactions.where('accountId').equals(accountId).toArray();
    const iv = generateIV();
    const encrypted = await encryptData(
      JSON.stringify({ transactions: rows, timestamp: new Date().toISOString(), version: QUICK_BACKUP_VERSION }),
      key,
      iv
    );

    return {
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(encrypted)),
      version: QUICK_BACKUP_VERSION,
      algorithm: 'AES-GCM-256',
    };
  })();
}

// Restores a v2 quick backup into `accountId`. Returns the restored count.
// The whole replacement happens inside one Dexie transaction — a failure
// leaves the existing rows untouched.
export async function restoreQuickBackup(backup, accountId) {
  const key = getSessionKey(accountId);
  if (!key) throw new Error('SESSION_EXPIRED');

  if (backup.version !== QUICK_BACKUP_VERSION || !backup.iv || !backup.ciphertext) {
    throw new Error('INVALID_FORMAT');
  }

  let payload;
  try {
    const decrypted = await decryptData(new Uint8Array(backup.ciphertext), key, new Uint8Array(backup.iv));
    payload = JSON.parse(decrypted);
  } catch {
    throw new Error('INVALID_FORMAT');
  }

  if (!payload.transactions || !Array.isArray(payload.transactions)) {
    throw new Error('INVALID_DATA');
  }

  const rows = payload.transactions.map((tx) => ({ ...tx, accountId }));
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions.where('accountId').equals(accountId).delete();
    await db.transactions.bulkAdd(rows);
  });
  return rows.length;
}

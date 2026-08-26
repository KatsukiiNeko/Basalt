// Backup creation, parsing, restore, and re-encryption. Owns all DB access
// for backup flows; pure crypto lives in primitives.js.
import { db } from '../db/db';
import {
  deriveKey,
  encryptData,
  decryptData,
  generateSalt,
  generateIV
} from './primitives';
import { PBKDF2_ITERATIONS } from './constants';
import { getSessionKey } from './sessionKeys';
import {
  encryptTransactionForStorage,
  decryptTransactionFromStorage,
  validateTransactionData
} from './transactionCrypto';


export async function createBackup(password) {
  const transactions = await db.transactions.toArray();

  const salt = generateSalt();
  const iv = generateIV();
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);

  const transactionsString = JSON.stringify(transactions);
  const encryptedTransactions = await encryptData(transactionsString, key, iv);

  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(encryptedTransactions)),
    version: 1,
    algorithm: 'AES-GCM-256'
  };
}

export async function restoreBackup(backup, password) {
  if (!backup || !backup.salt || !backup.iv || !backup.ciphertext) {
    throw new Error('Invalid backup format: missing required fields');
  }

  const salt = new Uint8Array(backup.salt);
  const iv = new Uint8Array(backup.iv);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);

  const encryptedData = new Uint8Array(backup.ciphertext);
  const decryptedData = await decryptData(encryptedData, key, iv);

  const parsed = JSON.parse(decryptedData);
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid backup data: expected array of transactions');
  }

  return parsed;
}

export async function createSecureBackup(password, accountId) {
  if (!password || password.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }

  const key = getSessionKey(accountId);
  if (!key) throw new Error('Session expired');

  const allEncrypted = await db.transactions.where('accountId').equals(accountId).toArray();
  const saltSetting = await db.settings.get('salt:' + accountId);
  const tokenSetting = await db.settings.get('verificationToken:' + accountId);
  const account = await db.accounts.get(accountId);

  const rawTransactions = [];
  let skippedCount = 0;
  for (const enc of allEncrypted) {
    try {
      const plain = await decryptTransactionFromStorage(enc, key);
      if (validateTransactionData(plain)) {
        rawTransactions.push(plain);
      } else {
        skippedCount++;
      }
    } catch {
      // One corrupt row must not abort the whole backup, but a silent skip
      // would hide data loss — the count is surfaced in the return metadata.
      skippedCount++;
    }
  }

  if (rawTransactions.length === 0 && allEncrypted.length > 0) {
    throw new Error('Failed to decrypt transactions');
  }

  const backupPayload = {
    transactions: rawTransactions,
    accountSalt: saltSetting ? saltSetting.value : null,
    verificationToken: tokenSetting ? tokenSetting.value : null,
    version: 3
  };

  const backupSalt = generateSalt();
  const backupIV = generateIV();
  const backupKey = await deriveKey(password, backupSalt, PBKDF2_ITERATIONS);

  const jsonString = JSON.stringify(backupPayload);
  const encrypted = await encryptData(jsonString, backupKey, backupIV);

  return {
    salt: Array.from(backupSalt),
    iv: Array.from(backupIV),
    ciphertext: Array.from(new Uint8Array(encrypted)),
    version: 3,
    algorithm: 'AES-GCM-256',
    iterations: PBKDF2_ITERATIONS,
    accountName: account ? account.name : 'Unknown',
    timestamp: new Date().toISOString(),
    // Rows that failed decryption/validation and are absent from the backup.
    skippedCount
  };
}

export async function parseSecureBackup(backup) {
  if (!backup || !backup.salt || !backup.iv || !backup.ciphertext) {
    throw new Error('Invalid backup format');
  }
  return {
    version: backup.version || 1,
    iterations: backup.iterations || PBKDF2_ITERATIONS,
    accountName: backup.accountName || null,
    timestamp: backup.timestamp || null
  };
}

export async function restoreSecureBackup(backup, password, accountId, overrideIterations) {
  if (!backup || !backup.salt || !backup.iv || !backup.ciphertext) {
    throw new Error('Invalid backup format: missing required fields');
  }
  if (!password || password.length < 4) {
    throw new Error('Password must be at least 4 characters');
  }

  const salt = new Uint8Array(backup.salt);
  const iv = new Uint8Array(backup.iv);
  const iterations = overrideIterations || backup.iterations || PBKDF2_ITERATIONS;
  const key = await deriveKey(password, salt, iterations);

  let decrypted;
  try {
    const encryptedData = new Uint8Array(backup.ciphertext);
    decrypted = await decryptData(encryptedData, key, iv);
  } catch {
    throw new Error('Wrong password or corrupted backup');
  }

  let backupPayload;
  try {
    backupPayload = JSON.parse(decrypted);
  } catch {
    throw new Error('Invalid backup data');
  }

  if (!backupPayload.transactions || !Array.isArray(backupPayload.transactions)) {
    throw new Error('Invalid backup data: missing transactions');
  }

  const validTransactions = [];
  for (const tx of backupPayload.transactions) {
    if (validateTransactionData(tx)) {
      validTransactions.push(tx);
    }
  }

  if (validTransactions.length === 0) {
    throw new Error('No valid transactions in backup');
  }

  const sessionKey = getSessionKey(accountId);
  if (!sessionKey) throw new Error('Session expired');

  const reEncrypted = [];
  for (const tx of validTransactions) {
    const encrypted = await encryptTransactionForStorage(tx, sessionKey);
    encrypted.accountId = accountId;
    reEncrypted.push(encrypted);
  }

  await db.transaction('rw', db.transactions, db.settings, async () => {
    await db.transactions.where('accountId').equals(accountId).delete();
    await db.transactions.bulkAdd(reEncrypted);

    if (backupPayload.accountSalt) {
      const existingSalt = await db.settings.get('salt:' + accountId);
      if (!existingSalt) {
        await db.settings.put({ key: 'salt:' + accountId, value: backupPayload.accountSalt });
      }
    }
    if (backupPayload.verificationToken) {
      const existingToken = await db.settings.get('verificationToken:' + accountId);
      if (!existingToken) {
        await db.settings.put({ key: 'verificationToken:' + accountId, value: backupPayload.verificationToken });
        await db.settings.put({ key: 'passwordSet:' + accountId, value: true });
      }
    }
  });

  return validTransactions.length;
}

export async function reEncryptTransactions(transactions, oldKey, newKey) {
  const reEncrypted = [];
  for (const tx of transactions) {
    const plain = await decryptTransactionFromStorage(tx, oldKey);
    const encrypted = await encryptTransactionForStorage(plain, newKey);
    reEncrypted.push(encrypted);
  }
  return reEncrypted;
}

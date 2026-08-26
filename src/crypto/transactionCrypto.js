// Verification tokens and per-transaction encrypt/decrypt helpers.
import { encryptData, decryptData, generateIV, constantTimeEquals } from './primitives';

export const VERIFICATION_PLAINTEXT = 'BASALT_VERIFY_v1';

export async function createVerificationToken(key) {
  const iv = generateIV();
  const encrypted = await encryptData(VERIFICATION_PLAINTEXT, key, iv);
  return {
    iv: Array.from(iv),
    ciphertext: Array.from(new Uint8Array(encrypted))
  };
}

export async function verifyPassword(key, token) {
  try {
    const iv = new Uint8Array(token.iv);
    const ciphertext = new Uint8Array(token.ciphertext);
    const decrypted = await decryptData(ciphertext, key, iv);
    // Constant-time compare (DR-0002): the sentinel is public today, but
    // GCM already rejected wrong keys before we get here — this is
    // defense-in-depth for any future secret-bearing sentinel.
    return await constantTimeEquals(decrypted, VERIFICATION_PLAINTEXT);
  } catch {
    return false;
  }
}

export async function encryptTransactionForStorage(transaction, key) {
  const iv = generateIV();
  const jsonString = JSON.stringify(transaction);
  const encrypted = await encryptData(jsonString, key, iv);
  return {
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(encrypted))
  };
}

export async function decryptTransactionFromStorage(encryptedTransaction, key) {
  if (!encryptedTransaction.iv || !encryptedTransaction.data) {
    return { ...encryptedTransaction };
  }
  const iv = new Uint8Array(encryptedTransaction.iv);
  const data = new Uint8Array(encryptedTransaction.data);
  const jsonString = await decryptData(data, key, iv);
  return JSON.parse(jsonString);
}

export function validateTransactionData(tx) {
  if (!tx || typeof tx !== 'object') return false;
  if (!tx.date || typeof tx.date !== 'string') return false;
  if (tx.type !== 'income' && tx.type !== 'expense') return false;
  if (tx.amount === undefined || typeof tx.amount !== 'number' || !isFinite(tx.amount) || tx.amount <= 0 || tx.amount > 999999999999) return false;
  if (!tx.category || typeof tx.category !== 'string') return false;
  if (tx.note && typeof tx.note === 'string' && tx.note.length > 500) return false;
  return true;
}

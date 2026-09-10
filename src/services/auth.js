// Authentication and key-lifecycle service for one account's vault.
//
// Owns: first-time password setup, unlock verification, account rekeying
// (password change and PBKDF2 iteration upgrade), and the lockout merge
// from the pre-V2 inline system onto the tested utils/lockout.js engine.
// WebCrypto primitives are imported from crypto/primitives — never
// re-implemented here.
import { db } from '../db/db';
import {
  deriveKey,
  generateSalt,
  createVerificationToken,
  verifyPassword,
  encryptTransactionForStorage,
  decryptTransactionFromStorage,
  setSessionKey,
} from '../crypto/crypto';
import { PBKDF2_ITERATIONS } from '../crypto/constants';

// Iterations used before the current standard; old vaults are still
// derivable with it and upgraded on next successful unlock.
const LEGACY_ITERATIONS = 200000;

export async function fetchAccountAuthState(accountId) {
  const [saltSetting, tokenSetting, passwordSet, iterVersion] = await Promise.all([
    db.settings.get('salt:' + accountId),
    db.settings.get('verificationToken:' + accountId),
    db.settings.get('passwordSet:' + accountId),
    db.settings.get('pbkdf2Version:' + accountId),
  ]);
  return {
    saltSetting,
    tokenSetting,
    isFirstTime: !passwordSet,
    storedIterations: iterVersion?.value || LEGACY_ITERATIONS,
  };
}

// Derive a key candidate from the stored salt at the vault's real iteration
// count. `iterations` exists so tests can run fast; production always uses
// the persisted pbkdf2Version (or the legacy default for old vaults).
export async function unlockAttempt(accountId, password, { iterations } = {}) {
  const { saltSetting, tokenSetting, storedIterations } = await fetchAccountAuthState(accountId);

  if (!saltSetting) throw new Error('CORRUPTED');
  if (!tokenSetting) throw new Error('TOKEN_MISSING');

  const saltArray = new Uint8Array(Object.values(saltSetting.value));
  const key = await deriveKey(password, saltArray, iterations ?? storedIterations);
  const isValid = await verifyPassword(key, tokenSetting.value);
  return { isValid, key, storedIterations };
}

export async function setupPassword(accountId, password, { iterations = PBKDF2_ITERATIONS } = {}) {
  const salt = generateSalt();
  const key = await deriveKey(password, salt, iterations);
  const token = await createVerificationToken(key);

  await db.settings.bulkPut([
    { key: 'salt:' + accountId, value: Array.from(salt) },
    { key: 'verificationToken:' + accountId, value: token },
    { key: 'passwordSet:' + accountId, value: true },
    { key: 'pbkdf2Version:' + accountId, value: iterations },
  ]);

  setSessionKey(key, accountId);
  return key;
}

// One-way rotation: decrypt every row with `oldKey`, re-encrypt with
// `newKey`, then swap salt+token+pbkdf2Version inside a single DB
// transaction. Any row that fails decryption aborts the ENTIRE rekey —
// unlike the pre-V2 inline code, which silently dropped undecryptable rows
// and would have destroyed them at the delete-all step. PasswordManager's
// inline version of this loop (throw on first bad row) matches.
async function rekeyVault(accountId, oldKey, newKey, newSalt, newIterations) {
  const rows = await db.transactions.where('accountId').equals(accountId).toArray();

  const decrypted = [];
  for (const row of rows) {
    const plain = await decryptTransactionFromStorage(row, oldKey);
    decrypted.push(plain);
  }

  const newToken = await createVerificationToken(newKey);

  const reEncrypted = [];
  for (const tx of decrypted) {
    const encrypted = await encryptTransactionForStorage(tx, newKey);
    encrypted.accountId = accountId;
    reEncrypted.push(encrypted);
  }

  await db.transaction('rw', db.transactions, db.settings, async () => {
    await db.transactions.where('accountId').equals(accountId).delete();
    await db.transactions.bulkAdd(reEncrypted);
    await db.settings.put({ key: 'salt:' + accountId, value: Array.from(newSalt) });
    await db.settings.put({ key: 'verificationToken:' + accountId, value: newToken });
    await db.settings.put({ key: 'pbkdf2Version:' + accountId, value: newIterations });
  });
}

// Change the vault password. Verifies the old password first; throws
// 'WRONG_PASSWORD' (mapped to UI copy by the caller) if it fails.
export async function changePassword(accountId, currentPassword, newPassword, { iterations = PBKDF2_ITERATIONS } = {}) {
  const attempt = await unlockAttempt(accountId, currentPassword);
  if (!attempt.isValid) throw new Error('WRONG_PASSWORD');

  const newSalt = generateSalt();
  const newKey = await deriveKey(newPassword, newSalt, iterations);
  await rekeyVault(accountId, attempt.key, newKey, newSalt, iterations);
  setSessionKey(newKey, accountId);
  return true;
}

// Destructive last-resort reset for a corrupted vault (token missing):
// wipes the account's transactions and auth state. The user re-enters
// setup afterwards with a fresh password.
export async function deleteAccount(accountId) {
  await db.transaction('rw', db.transactions, db.settings, db.accounts, async () => {
    await db.transactions.where('accountId').equals(accountId).delete();
    await db.settings.bulkDelete([
      'salt:' + accountId,
      'verificationToken:' + accountId,
      'passwordSet:' + accountId,
      'pbkdf2Version:' + accountId,
      'lockoutData:' + accountId,
      'pwdLockout:' + accountId,
    ]);
  });
}

// Upgrade a legacy-iteration vault to the current PBKDF2 standard after a
// successful unlock. Runs with the freshly verified old key. Failure is
// never silent: corruption must surface, not data.
export async function upgradePbkdf2(accountId, verifiedOldKey, password, { iterations = PBKDF2_ITERATIONS } = {}) {
  const newSalt = generateSalt();
  const newKey = await deriveKey(password, newSalt, iterations);
  try {
    await rekeyVault(accountId, verifiedOldKey, newKey, newSalt, iterations);
    setSessionKey(newKey, accountId);
  } catch (err) {
    // Re-throw with cause so lockout/upgrade failures stay debuggable; the
    // raw error never reaches user-facing copy.
    throw new Error('REKEY_FAILED', { cause: err });
  }
}

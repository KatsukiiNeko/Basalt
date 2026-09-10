// Public crypto facade. Re-exports the split modules under their original
// names so existing component imports keep working unchanged.
//
// Layout:
//   primitives.js         — raw WebCrypto ops + constant-time equals
//   sessionKeys.js        — in-memory per-account key registry
//   transactionCrypto.js  — verification tokens, per-tx encrypt/decrypt
//   backupService.js      — backup/restore flows (DB-aware)
//   constants.js          — PBKDF2_ITERATIONS etc.

export { PBKDF2_ITERATIONS } from './constants';

export {
  deriveKey,
  encryptData,
  decryptData,
  generateSalt,
  generateIV
} from './primitives';

export {
  getSessionKey,
  setSessionKey,
  clearSessionKey,
  clearAllSessionKeys,
  getActiveAccountId,
  setActiveAccountId
} from './sessionKeys';

export {
  VERIFICATION_PLAINTEXT,
  createVerificationToken,
  verifyPassword,
  encryptTransactionForStorage,
  decryptTransactionFromStorage
} from './transactionCrypto';

export {
  createBackup,
  restoreBackup,
  createSecureBackup,
  parseSecureBackup,
  restoreSecureBackup
} from './backupService';

export { validateTransactionData } from './transactionCrypto';

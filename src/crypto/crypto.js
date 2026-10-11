// Our crypto facade — this is the one file components import from, so the
// split into five modules stays invisible to them: everything below is
// re-exported under the names the original single-file module used, and
// old imports keep working unchanged. There is no logic in here; if a
// behaviour looks wrong, fix it in the module that owns the function.
//
// Layout:
//   primitives.js         — raw WebCrypto ops + constant-time equals
//   sessionKeys.js        — in-memory per-account key registry
//   transactionCrypto.js  — verification tokens, per-tx encrypt/decrypt
//   backupService.js      — backup/restore flows (DB-aware)
//   constants.js          — PBKDF2_ITERATIONS etc.
//
// The facade is not a hard boundary: services/auth.js imports
// constants.js and services/transactions.js imports transactionCrypto.js
// directly instead of routing through here. And constantTimeEquals — used
// only by verifyPassword — is deliberately left out of the re-exports
// above; import it from primitives.js if you ever need it.

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

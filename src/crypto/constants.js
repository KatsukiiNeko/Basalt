// Our PBKDF2 work factor: the default every key in the app is derived
// with — vault keys through primitives.deriveKey, backup keys through
// backupService, and the check LockScreen runs after a successful unlock
// (storedIterations < PBKDF2_ITERATIONS → upgrade the vault).
//
// Changing PBKDF2_ITERATIONS invalidates every derived key on disk, which
// is why tests/crypto.test.js pins this value at 600000 (its own note:
// changing it triggers re-encryption logic).
export const PBKDF2_ITERATIONS = 600000;

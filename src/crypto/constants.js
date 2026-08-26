// Crypto configuration constants. Changing PBKDF2_ITERATIONS invalidates
// every derived key on disk — see tests/crypto.test.js which pins this value.
export const PBKDF2_ITERATIONS = 600000;

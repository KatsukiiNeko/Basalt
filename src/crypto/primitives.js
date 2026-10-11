// The bottom of our crypto stack: raw WebCrypto calls only — no session
// state, no DB access, no idea what a transaction is. Everything here is
// generic plumbing that crypto.js re-exports (constantTimeEquals is the
// exception: only transactionCrypto.js uses it, so it isn't re-exported).
import { PBKDF2_ITERATIONS } from './constants';

export async function deriveKey(password, salt, iterations = PBKDF2_ITERATIONS) {
  const enc = new TextEncoder();
  const passwordBuffer = enc.encode(password);

  const baseKey = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: iterations,
      hash: 'SHA-384'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );

  return derivedKey;
}

export async function encryptData(data, key, iv) {
  const encodedData = new TextEncoder().encode(data);
  return await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encodedData
  );
}

export async function decryptData(data, key, iv) {
  const decryptedData = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    data
  );
  return new TextDecoder().decode(decryptedData);
}

export function generateSalt(length = 16) {
  return window.crypto.getRandomValues(new Uint8Array(length));
}

export function generateIV(length = 12) {
  return window.crypto.getRandomValues(new Uint8Array(length));
}

// Our timing-safe compare for short secret strings — used by
// verifyPassword() to check the decrypted sentinel. We hash both operands
// to fixed-length SHA-256 digests (hiding the input length), then XOR the
// digests together and fold them into a single int, so every bit of the
// digest influences the result regardless of where a difference lies.
// Don't "simplify" this to `===`: that short-circuits at the first
// mismatching byte and leaks how far the comparison got.
export async function constantTimeEquals(a, b) {
  const enc = new TextEncoder();
  const [digestA, digestB] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(a)),
    crypto.subtle.digest('SHA-256', enc.encode(b))
  ]);
  const bytesA = new Uint8Array(digestA);
  const bytesB = new Uint8Array(digestB);
  let diff = 0;
  for (let i = 0; i < bytesA.length; i++) {
    diff |= bytesA[i] ^ bytesB[i];
  }
  return diff === 0;
}

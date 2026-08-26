// Low-level WebCrypto primitives. No session state, no DB access.
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

// Timing-safe equality for short secret strings: both operands are hashed to
// fixed-length digests (hiding length), then XOR-folded so every bit of the
// digest influences the result regardless of where a difference lies.
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

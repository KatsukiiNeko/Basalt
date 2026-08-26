import { describe, it, expect, beforeEach } from 'vitest';
import {
  PBKDF2_ITERATIONS,
  deriveKey,
  encryptData,
  decryptData,
  generateSalt,
  generateIV,
  createVerificationToken,
  verifyPassword,
  encryptTransactionForStorage,
  decryptTransactionFromStorage,
  validateTransactionData,
  restoreBackup,
  getSessionKey,
  setSessionKey,
  clearSessionKey,
  clearAllSessionKeys,
  getActiveAccountId,
  setActiveAccountId
} from '../src/crypto/crypto';

// Low iteration count keeps PBKDF2-derived-key tests fast; the default value
// itself is pinned separately below.
const FAST_ITERATIONS = 1000;

describe('PBKDF2_ITERATIONS constant', () => {
  it('is pinned at 600000 (changing it triggers re-encryption logic)', () => {
    expect(PBKDF2_ITERATIONS).toBe(600000);
  });
});

describe('deriveKey + encryptData/decryptData round-trip', () => {
  it('decrypts what was encrypted with the same derived key', async () => {
    const salt = generateSalt();
    const key = await deriveKey('correct horse', salt, FAST_ITERATIONS);
    const iv = generateIV();

    const ciphertext = await encryptData('secret payload', key, iv);
    const plaintext = await decryptData(ciphertext, key, iv);

    expect(plaintext).toBe('secret payload');
  });

  it('same password + same salt yields an interchangeable key', async () => {
    const salt = generateSalt();
    const keyA = await deriveKey('pw', salt, FAST_ITERATIONS);
    const keyB = await deriveKey('pw', salt, FAST_ITERATIONS);

    const iv = generateIV();
    const ct = await encryptData('interop', keyA, iv);
    await expect(decryptData(ct, keyB, iv)).resolves.toBe('interop');
  });

  it('different password fails decryption (wrong key rejected by GCM)', async () => {
    const salt = generateSalt();
    const goodKey = await deriveKey('right', salt, FAST_ITERATIONS);
    const badKey = await deriveKey('wrong', salt, FAST_ITERATIONS);

    const iv = generateIV();
    const ct = await encryptData('classified', goodKey, iv);
    await expect(decryptData(ct, badKey, iv)).rejects.toThrow();
  });

  it('different salt yields a different key', async () => {
    const keyA = await deriveKey('pw', generateSalt(), FAST_ITERATIONS);
    const keyB = await deriveKey('pw', generateSalt(), FAST_ITERATIONS);

    const iv = generateIV();
    const ct = await encryptData('x', keyA, iv);
    await expect(decryptData(ct, keyB, iv)).rejects.toThrow();
  });
});

describe('ciphertext integrity', () => {
  it('a single flipped bit in the ciphertext breaks decryption', async () => {
    const key = await deriveKey('pw', generateSalt(), FAST_ITERATIONS);
    const iv = generateIV();
    const ct = new Uint8Array(await encryptData('integrity matter', key, iv));

    ct[0] ^= 0x01;
    await expect(decryptData(ct, key, iv)).rejects.toThrow();
  });

  it('a tampered IV breaks decryption', async () => {
    const key = await deriveKey('pw', generateSalt(), FAST_ITERATIONS);
    const iv = generateIV();
    const ct = await encryptData('tamper me', key, iv);

    const badIv = new Uint8Array(iv);
    badIv[0] ^= 0xff;
    await expect(decryptData(ct, key, badIv)).rejects.toThrow();
  });
});

describe('verification token', () => {
  it('verifies with the correct key and rejects a wrong key', async () => {
    const salt = generateSalt();
    const goodKey = await deriveKey('hunter2', salt, FAST_ITERATIONS);
    const badKey = await deriveKey('hunter3', salt, FAST_ITERATIONS);

    const token = await createVerificationToken(goodKey);

    await expect(verifyPassword(goodKey, token)).resolves.toBe(true);
    await expect(verifyPassword(badKey, token)).resolves.toBe(false);
  });

  it('returns false instead of throwing on malformed tokens', async () => {
    const key = await deriveKey('pw', generateSalt(), FAST_ITERATIONS);
    await expect(verifyPassword(key, {})).resolves.toBe(false);
    await expect(verifyPassword(key, null)).resolves.toBe(false);
  });
});

describe('transaction storage format', () => {
  const tx = {
    id: 1,
    accountId: 'default',
    date: '2026-08-25',
    type: 'expense',
    category: 'Food & Dining',
    amount: 1250000,
    note: 'lunch'
  };

  it('round-trips a transaction losslessly', async () => {
    const key = await deriveKey('pw', generateSalt(), FAST_ITERATIONS);
    const stored = await encryptTransactionForStorage(tx, key);

    // Stored shape: base64-free plain arrays, no plaintext leakage.
    expect(stored).toHaveProperty('iv');
    expect(stored).toHaveProperty('data');
    expect(JSON.stringify(stored)).not.toContain('Food');

    const restored = await decryptTransactionFromStorage(stored, key);
    expect(restored).toEqual(tx);
  });

  it('passes through records that lack the encrypted shape untouched', async () => {
    const legacy = { id: 2, amount: 5 };
    const out = await decryptTransactionFromStorage(legacy, null);
    expect(out).toEqual(legacy);
  });
});

describe('validateTransactionData', () => {
  const validTx = {
    date: '2026-08-25',
    type: 'expense',
    amount: 42,
    category: 'Shopping'
  };

  it.each([
    ['valid baseline', validTx, true],
    ['income type accepted', { ...validTx, type: 'income' }, true],
    ['unknown type rejected', { ...validTx, type: 'transfer' }, false],
    ['negative amount rejected', { ...validTx, amount: -1 }, false],
    ['zero amount rejected', { ...validTx, amount: 0 }, false],
    ['NaN amount rejected', { ...validTx, amount: NaN }, false],
    ['over-cap amount rejected', { ...validTx, amount: 1e12 }, false],
    ['max allowed amount accepted', { ...validTx, amount: 999999999999 }, true],
    ['missing date rejected', { ...validTx, date: undefined }, false],
    ['missing category rejected', { ...validTx, category: '' }, false],
    ['note over 500 chars rejected', { ...validTx, note: 'x'.repeat(501) }, false],
    ['note exactly 500 chars accepted', { ...validTx, note: 'x'.repeat(500) }, true],
    ['null tx rejected', null, false]
  ])('%s', (_label, input, expected) => {
    expect(validateTransactionData(input)).toBe(expected);
  });
});

describe('v1 backup restore (pure crypto path)', () => {
  // restoreBackup() derives keys with the production default (600k), so
  // fixtures MUST be built with the same iteration count or GCM will reject.
  const PROD_ITERATIONS = PBKDF2_ITERATIONS;

  it('restores a v1-format backup built with the same primitives', async () => {
    const password = 'backup-pass';
    const salt = generateSalt();
    const iv = generateIV();
    const key = await deriveKey(password, salt, PROD_ITERATIONS);
    const payload = [{ date: '2026-01-01', type: 'income', amount: 100, category: 'Salary' }];

    const backup = {
      salt: Array.from(salt),
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(await encryptData(JSON.stringify(payload), key, iv))),
      version: 1,
      algorithm: 'AES-GCM-256'
    };

    await expect(restoreBackup(backup, password)).resolves.toEqual(payload);
  });

  it('rejects backups missing required fields', async () => {
    await expect(restoreBackup({}, 'pass1234')).rejects.toThrow(/missing required fields/);
    await expect(restoreBackup(null, 'pass1234')).rejects.toThrow();
  });

  it('rejects the wrong password', async () => {
    const salt = generateSalt();
    const iv = generateIV();
    const key = await deriveKey('right', salt, FAST_ITERATIONS);
    const backup = {
      salt: Array.from(salt),
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(await encryptData('[]', key, iv))),
      version: 1
    };
    await expect(restoreBackup(backup, 'wrong')).rejects.toThrow();
  });

  it('rejects payloads that are not arrays', async () => {
    const salt = generateSalt();
    const iv = generateIV();
    const key = await deriveKey('pw', salt, PROD_ITERATIONS);
    const backup = {
      salt: Array.from(salt),
      iv: Array.from(iv),
      ciphertext: Array.from(new Uint8Array(await encryptData('{"not":"array"}', key, iv))),
      version: 1
    };
    await expect(restoreBackup(backup, 'pw')).rejects.toThrow();
  });
});

describe('session key registry', () => {
  beforeEach(() => {
    clearAllSessionKeys();
  });

  it('set/get/clear lifecycle per account', () => {
    const keyA = {};
    const keyB = {};
    setSessionKey(keyA, 'acct-a');
    expect(getSessionKey('acct-a')).toBe(keyA);
    expect(getActiveAccountId()).toBe('acct-a');

    setSessionKey(keyB, 'acct-b');
    expect(getSessionKey('acct-b')).toBe(keyB);
    expect(getSessionKey('acct-a')).toBe(keyA);

    clearSessionKey(); // clears active account (acct-b)
    expect(getSessionKey('acct-b')).toBeNull();
    expect(getSessionKey('acct-a')).toBe(keyA);

    clearAllSessionKeys();
    expect(getSessionKey('acct-a')).toBeNull();
    expect(getActiveAccountId()).toBeNull();
  });

  it('getSessionKey falls back to active account id', () => {
    const key = {};
    setActiveAccountId('acct-x');
    setSessionKey(key); // no explicit id -> uses active
    expect(getSessionKey()).toBe(key);
  });

  it('returns null when nothing is registered', () => {
    expect(getSessionKey('never-set')).toBeNull();
    expect(getSessionKey()).toBeNull();
  });
});

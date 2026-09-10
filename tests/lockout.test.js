import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeBackupFingerprint,
  getLockoutState,
  checkLockout,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  getEscalatedIterations,
  getPoWChallenge,
  computeProofOfWork,
  getPwdLockoutState,
  recordPwdFailedAttempt,
  recordPwdSuccessfulAttempt,
  checkPwdLockout
} from '../src/utils/lockout';
import { db } from '../src/db/db';

const FP = 'test-fingerprint-abc123';
const ACCT = 'acct-under-test';

beforeEach(async () => {
  localStorage.clear();
  sessionStorage.clear();
  await db.settings.bulkDelete([
    'backupLockout:' + FP,
    'pwdLockout:' + ACCT
  ]).catch(() => {});
});

describe('computeBackupFingerprint', () => {
  it('is deterministic for identical backups', async () => {
    const backup = { salt: [1, 2, 3], ciphertext: [9, 8, 7, 6] };
    const a = await computeBackupFingerprint(backup);
    const b = await computeBackupFingerprint(backup);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it('differs when salt or ciphertext differ', async () => {
    const base = { salt: [1, 2, 3], ciphertext: [9, 8, 7, 6] };
    const otherSalt = { ...base, salt: [1, 2, 4] };
    const otherCt = { ...base, ciphertext: [9, 8, 7, 5] };

    const a = await computeBackupFingerprint(base);
    expect(await computeBackupFingerprint(otherSalt)).not.toBe(a);
    expect(await computeBackupFingerprint(otherCt)).not.toBe(a);
  });
});

describe('lockout tiers — time lockout escalation', () => {
  it('no lockout below threshold of 3', async () => {
    await recordFailedAttempt(FP);
    await recordFailedAttempt(FP);
    const verdict = await checkLockout(FP);
    expect(verdict.locked).toBe(false);

    const state = await getLockoutState(FP);
    expect(state.failedAttempts).toBe(2);
    expect(state.pbkdf2Multiplier).toBe(1);
  });

  it('locks at attempt 3 (first tier)', async () => {
    for (let i = 0; i < 3; i++) await recordFailedAttempt(FP);
    const state = await getLockoutState(FP);
    expect(state.failedAttempts).toBe(3);
    // Tier at 3 has duration 0 -> lockoutUntil is now+0 (already expired),
    // so no time lockout, but the tier is recorded.
    const verdict = await checkLockout(FP);
    expect(verdict.locked).toBe(false);
    expect(state.lockoutUntil).toBeLessThanOrEqual(Date.now());
  });

  it('applies 30s lockout and x2 multiplier from attempt 5', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt(FP);
    const state = await getLockoutState(FP);
    expect(state.failedAttempts).toBe(5);
    expect(state.pbkdf2Multiplier).toBe(2);

    const verdict = await checkLockout(FP);
    expect(verdict.locked).toBe(true);
    expect(verdict.reason).toBe('time_lockout');
    expect(verdict.retryAfter).toBeGreaterThan(25000);
    expect(verdict.retryAfter).toBeLessThanOrEqual(30000);
  });

  it('reaches the top tier (30 min, x50) at attempt 20 — but session cap wins', async () => {
    for (let i = 0; i < 20; i++) await recordFailedAttempt(FP);
    const state = await getLockoutState(FP);
    expect(state.failedAttempts).toBe(20);
    expect(state.pbkdf2Multiplier).toBe(50);

    // SESSION_HARD_CAP = 20 is checked BEFORE time lockouts, so the 30-min
    // tier manifests as state, while the verdict reports session_limit.
    const verdict = await checkLockout(FP);
    expect(verdict.reason).toBe('session_limit');
    expect(verdict.retryAfter).toBe(Infinity);

    // The 30-minute tier is still recorded on the persisted timestamp.
    const fresh = await getLockoutState(FP);
    expect(fresh.lockoutUntil - Date.now()).toBeLessThanOrEqual(30 * 60 * 1000);
    expect(fresh.lockoutUntil - Date.now()).toBeGreaterThan(29 * 60 * 1000);

    // One attempt below the hard cap the 16-attempt tier still yields a
    // plain time lockout verdict (600s), proving tier ordering.
    for (let i = 0; i < 19; i++) await recordFailedAttempt('fp-19');
    const v19 = await checkLockout('fp-19');
    expect(v19.reason).toBe('time_lockout');
    expect(v19.retryAfter).toBeGreaterThan(9.5 * 60 * 1000);
    expect(v19.retryAfter).toBeLessThanOrEqual(10 * 60 * 1000);
    await db.settings.bulkDelete(['backupLockout:fp-19']).catch(() => {});
  });
});

describe('session hard cap', () => {
  it('session_limit overrides everything after 20 session attempts', async () => {
    for (let i = 0; i < 21; i++) await recordFailedAttempt(FP);
    const verdict = await checkLockout(FP);
    expect(verdict.locked).toBe(true);
    expect(verdict.reason).toBe('session_limit');
    expect(verdict.retryAfter).toBe(Infinity);
  });

  it('session counter survives clearing persistent stores only', async () => {
    for (let i = 0; i < 5; i++) await recordFailedAttempt(FP);
    // Attacker clears LS+IDB but sessionStorage still counts.
    localStorage.clear();
    await db.settings.bulkDelete(['backupLockout:' + FP]).catch(() => {});
    const state = await getLockoutState(FP);
    expect(state.sessionAttempts).toBe(5);
  });
});

describe('mirror persistence across LS / SS / IDB', () => {
  it('state is readable from all three mirrors', async () => {
    await recordFailedAttempt(FP);
    await recordFailedAttempt(FP);

    const ls = JSON.parse(localStorage.getItem('mv_backup_lockouts'));
    const ss = JSON.parse(sessionStorage.getItem('mv_backup_session'));
    const idbRec = await db.settings.get('backupLockout:' + FP);

    expect(ls[FP].failedAttempts).toBe(2);
    expect(ss[FP].attempts).toBe(2);
    expect(idbRec.value.failedAttempts).toBe(2);
  });

  it('takes the MAX across mirrors if one lags behind', async () => {
    // IDB says 4 attempts, LS empty.
    await db.settings.put({
      key: 'backupLockout:' + FP,
      value: { failedAttempts: 4, lastAttemptTs: Date.now(), lockoutUntil: 0, pbkdf2Multiplier: 2, version: 1 }
    });
    const state = await getLockoutState(FP);
    expect(state.failedAttempts).toBe(4);
    expect(state.pbkdf2Multiplier).toBe(2);
  });
});

describe('recordSuccessfulAttempt resets state', () => {
  it('clears counters in all three mirrors', async () => {
    for (let i = 0; i < 6; i++) await recordFailedAttempt(FP);
    await recordSuccessfulAttempt(FP);

    const state = await getLockoutState(FP);
    expect(state.failedAttempts).toBe(0);
    expect(state.sessionAttempts).toBe(0);
    expect(state.pbkdf2Multiplier).toBe(1);

    const verdict = await checkLockout(FP);
    expect(verdict.locked).toBe(false);

    expect(JSON.parse(localStorage.getItem('mv_backup_lockouts'))[FP]).toBeUndefined();
    expect(JSON.parse(sessionStorage.getItem('mv_backup_session'))[FP]).toBeUndefined();
  });
});

describe('getEscalatedIterations', () => {
  it('multiplies the base iteration count by the tier multiplier', () => {
    expect(getEscalatedIterations(600000, 1)).toBe(600000);
    expect(getEscalatedIterations(600000, 2)).toBe(1200000);
    expect(getEscalatedIterations(600000, 50)).toBe(30000000);
  });

  it('is capped even for absurd multipliers', () => {
    expect(getEscalatedIterations(600000, 100)).toBe(60000000);
    expect(getEscalatedIterations(600000, 1000)).toBe(60000000); // hard cap
  });
});

describe('proof-of-work challenge gating', () => {
  it('no challenge below 10 failed attempts', () => {
    expect(getPoWChallenge(FP, 9)).toBeNull();
    expect(getPoWChallenge(FP, 0)).toBeNull();
  });

  it('issues a challenge from attempt 10 with escalating difficulty', () => {
    const c10 = getPoWChallenge(FP, 10);
    expect(c10.difficulty).toBe(20);
    expect(c10.challenge).toHaveLength(16);

    expect(getPoWChallenge(FP, 11).difficulty).toBe(22);
    expect(getPoWChallenge(FP, 12).difficulty).toBe(24);
  });

  it('difficulty caps at 40', () => {
    expect(getPoWChallenge(FP, 25).difficulty).toBe(40);
    expect(getPoWChallenge(FP, 500).difficulty).toBe(40);
  });

  it('challenges are random per call', () => {
    const a = getPoWChallenge(FP, 10);
    const b = getPoWChallenge(FP, 10);
    expect(Array.from(a.challenge)).not.toEqual(Array.from(b.challenge));
  });
});

describe('computeProofOfWork', () => {
  it('finds a nonce whose hash meets low difficulty quickly', async () => {
    const challenge = Array.from(crypto.getRandomValues(new Uint8Array(16)));
    const { nonce, hash } = await computeProofOfWork(challenge, 8);

    // Verify independently: recompute hash(challenge || nonceBE).
    const ch = new Uint8Array(challenge);
    const nb = new Uint8Array(4);
    nb[0] = (nonce >>> 24) & 0xff;
    nb[1] = (nonce >>> 16) & 0xff;
    nb[2] = (nonce >>> 8) & 0xff;
    nb[3] = nonce & 0xff;
    const combined = new Uint8Array(ch.length + 4);
    combined.set(ch);
    combined.set(nb, ch.length);
    const recomputed = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));

    expect(Array.from(recomputed)).toEqual(hash);

    let leadingZeros = 0;
    for (const byte of recomputed) {
      if (byte === 0) { leadingZeros += 8; }
      else {
        let b = byte;
        while (!(b & 0x80)) { leadingZeros++; b <<= 1; }
        break;
      }
      if (leadingZeros >= 8) break;
    }
    expect(leadingZeros).toBeGreaterThanOrEqual(8);
  });
});

describe('password lockout system (per-accountId)', () => {
  it('mirrors the backup-system tier behavior independently', async () => {
    for (let i = 0; i < 5; i++) await recordPwdFailedAttempt(ACCT);
    const state = await getPwdLockoutState(ACCT);
    expect(state.failedAttempts).toBe(5);

    const verdict = await checkPwdLockout(ACCT);
    expect(verdict.locked).toBe(true);
    expect(verdict.reason).toBe('time_lockout');
    expect(verdict.retryAfter).toBeLessThanOrEqual(30000);
  });

  it('keeps accounts isolated from each other', async () => {
    for (let i = 0; i < 5; i++) await recordPwdFailedAttempt(ACCT);
    const other = await getPwdLockoutState('other-account');
    expect(other.failedAttempts).toBe(0);
    expect((await checkPwdLockout('other-account')).locked).toBe(false);
  });

  it('success clears all mirrors for that account only', async () => {
    for (let i = 0; i < 5; i++) await recordPwdFailedAttempt(ACCT);
    for (let i = 0; i < 5; i++) await recordPwdFailedAttempt('acct-two');

    await recordPwdSuccessfulAttempt(ACCT);

    expect((await getPwdLockoutState(ACCT)).failedAttempts).toBe(0);
    expect((await getPwdLockoutState('acct-two')).failedAttempts).toBe(5);
  });

  it('session hard cap applies to pwd system too', async () => {
    for (let i = 0; i < 21; i++) await recordPwdFailedAttempt(ACCT);
    const verdict = await checkPwdLockout(ACCT);
    expect(verdict.reason).toBe('session_limit');
  });
});

describe('pwd lockout: legacy unlock-state merge (pre-V2 LockScreen)', () => {
  // V2's LockScreen reads the same pwd-lockout engine as backup restore.
  // Returning users carry attempt history in the OLD inline stores
  // ('mv_cumulative_attempts' in localStorage, 'lockoutData:<id>' in IDB).
  // The merge must take the max and clear legacy keys — never reset history.

  it('folds legacy localStorage attempts into the first V2 read', async () => {
    localStorage.setItem('mv_cumulative_attempts', JSON.stringify({
      [ACCT]: { attempts: 4, lastAttempt: Date.now() },
    }));

    const state = await getPwdLockoutState(ACCT);
    expect(state.failedAttempts).toBe(4);
  });

  it('folds legacy IDB lockout expiry into the first V2 read', async () => {
    const endTime = Date.now() + 60_000;
    await db.settings.put({
      key: 'lockoutData:' + ACCT,
      value: { endTime, failedAttempts: 3 },
    });

    const state = await getPwdLockoutState(ACCT);
    expect(state.failedAttempts).toBe(3);
    expect(state.lockoutUntil).toBeGreaterThanOrEqual(endTime);
  });

  it('takes the max across all stores rather than resetting', async () => {
    localStorage.setItem('mv_cumulative_attempts', JSON.stringify({
      [ACCT]: { attempts: 2, lastAttempt: Date.now() },
    }));
    await db.settings.put({
      key: 'lockoutData:' + ACCT,
      value: { endTime: 0, failedAttempts: 6 },
    });
    // New-system count: seed one failure, then read.
    await recordPwdFailedAttempt(ACCT); // reads legacy(6) -> writes 7, clears legacy

    const state = await getPwdLockoutState(ACCT);
    expect(state.failedAttempts).toBe(7);

    // Legacy keys are gone after the failure write — no double counting.
    const legacyLs = JSON.parse(localStorage.getItem('mv_cumulative_attempts') || '{}');
    expect(legacyLs[ACCT]).toBeUndefined();
    expect(await db.settings.get('lockoutData:' + ACCT)).toBeUndefined();
  });

  it('successful unlock clears both legacy stores and the new state', async () => {
    localStorage.setItem('mv_cumulative_attempts', JSON.stringify({
      [ACCT]: { attempts: 9, lastAttempt: Date.now() },
    }));
    await db.settings.put({
      key: 'lockoutData:' + ACCT,
      value: { endTime: Date.now() + 30_000, failedAttempts: 9 },
    });

    await recordPwdSuccessfulAttempt(ACCT);

    expect((await getPwdLockoutState(ACCT)).failedAttempts).toBe(0);
    const legacyLs = JSON.parse(localStorage.getItem('mv_cumulative_attempts') || '{}');
    expect(legacyLs[ACCT]).toBeUndefined();
    expect(await db.settings.get('lockoutData:' + ACCT)).toBeUndefined();
  });

  it('corrupted legacy JSON is ignored, not fatal', async () => {
    localStorage.setItem('mv_cumulative_attempts', '{not-json');
    const state = await getPwdLockoutState(ACCT);
    expect(state.failedAttempts).toBeGreaterThanOrEqual(0);
  });
});

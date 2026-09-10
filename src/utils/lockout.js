import { db } from '../db/db';

const BACKUP_LOCKOUT_LS_KEY = 'mv_backup_lockouts';
const BACKUP_LOCKOUT_SS_KEY = 'mv_backup_session';
const IDB_KEY_PREFIX = 'backupLockout:';

const PWD_LOCKOUT_LS_KEY = 'mv_pwd_lockouts';
const PWD_LOCKOUT_SS_KEY = 'mv_pwd_session';
const PWD_IDB_PREFIX = 'pwdLockout:';

const SESSION_HARD_CAP = 20;
const PBKDF2_MAX_MULTIPLIER = 100;
const POW_THRESHOLD = 10;
const POW_BASE_DIFFICULTY = 20;
const POW_DIFFICULTY_STEP = 2;
const POW_MAX_DIFFICULTY = 40;

const LOCKOUT_TIERS = [
  { threshold: 3,  duration: 0,           multiplier: 1  },
  { threshold: 5,  duration: 30_000,      multiplier: 2  },
  { threshold: 8,  duration: 120_000,     multiplier: 5  },
  { threshold: 12, duration: 300_000,     multiplier: 10 },
  { threshold: 16, duration: 600_000,     multiplier: 20 },
  { threshold: 20, duration: 1_800_000,   multiplier: 50 },
];

function readLocalStorage() {
  try { return JSON.parse(localStorage.getItem(BACKUP_LOCKOUT_LS_KEY) || '{}'); }
  // An unreadable mirror degrades to empty — the other two stores still
  // hold the lockout state, which is the whole point of triple-mirroring.
  catch { return {}; }
}

function writeLocalStorage(store) {
  try { localStorage.setItem(BACKUP_LOCKOUT_LS_KEY, JSON.stringify(store)); }
  // A failed mirror write cannot be surfaced to an attacker; the IDB and
  // session mirrors still gate the next attempt.
  catch { /* one mirror down, two remain */ }
}

function readSessionStorage() {
  try { return JSON.parse(sessionStorage.getItem(BACKUP_LOCKOUT_SS_KEY) || '{}'); }
  catch { return {}; /* degraded mirror = empty, others hold state */ }
}

function writeSessionStorage(store) {
  try { sessionStorage.setItem(BACKUP_LOCKOUT_SS_KEY, JSON.stringify(store)); }
  // One mirror failing is tolerated; the other two still gate the next try.
  catch { /* mirror write failed */ }
}

async function readIDB(fingerprint) {
  try {
    const record = await db.settings.get(IDB_KEY_PREFIX + fingerprint);
    return record?.value || null;
  } catch { return null; /* degraded mirror, others hold state */ }
}

async function writeIDB(fingerprint, state) {
  try {
    await db.settings.put({ key: IDB_KEY_PREFIX + fingerprint, value: state });
  // Same mirror-tolerance policy as writeSessionStorage above.
  } catch { /* mirror write failed */ }
}

export async function computeBackupFingerprint(backup) {
  const saltBuf = new Uint8Array(backup.salt);
  const ctHash = await crypto.subtle.digest('SHA-256', new Uint8Array(backup.ciphertext));
  const ctSlice = new Uint8Array(ctHash).slice(0, 16);

  const combined = new Uint8Array(saltBuf.length + ctSlice.length);
  combined.set(saltBuf);
  combined.set(ctSlice, saltBuf.length);

  const finalHash = await crypto.subtle.digest('SHA-256', combined);
  return Array.from(new Uint8Array(finalHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function getLockoutState(fingerprint) {
  const idbState = await readIDB(fingerprint);
  const lsStore = readLocalStorage();
  const lsState = lsStore[fingerprint] || null;
  const ssStore = readSessionStorage();
  const ssState = ssStore[fingerprint] || null;

  const maxAttempts = Math.max(
    idbState?.failedAttempts ?? 0,
    lsState?.failedAttempts ?? 0
  );
  const maxLockoutUntil = Math.max(
    idbState?.lockoutUntil ?? 0,
    lsState?.lockoutUntil ?? 0
  );
  const maxMultiplier = Math.max(
    idbState?.pbkdf2Multiplier ?? 1,
    lsState?.pbkdf2Multiplier ?? 1
  );

  return {
    failedAttempts: maxAttempts,
    lockoutUntil: maxLockoutUntil,
    sessionAttempts: ssState?.attempts ?? 0,
    pbkdf2Multiplier: Math.min(maxMultiplier, PBKDF2_MAX_MULTIPLIER),
  };
}

export async function checkLockout(fingerprint) {
  const state = await getLockoutState(fingerprint);

  if (state.sessionAttempts >= SESSION_HARD_CAP) {
    return {
      locked: true,
      reason: 'session_limit',
      retryAfter: Infinity,
    };
  }

  if (Date.now() < state.lockoutUntil) {
    return {
      locked: true,
      reason: 'time_lockout',
      retryAfter: state.lockoutUntil - Date.now(),
    };
  }

  return { locked: false };
}

export async function recordFailedAttempt(fingerprint) {
  const state = await getLockoutState(fingerprint);
  const newAttempts = state.failedAttempts + 1;
  const newSessionAttempts = state.sessionAttempts + 1;

  let lockoutUntil = 0;
  let multiplier = 1;
  for (const tier of LOCKOUT_TIERS) {
    if (newAttempts >= tier.threshold) {
      lockoutUntil = Date.now() + tier.duration;
      multiplier = tier.multiplier;
    }
  }
  multiplier = Math.min(multiplier, PBKDF2_MAX_MULTIPLIER);

  const newState = {
    failedAttempts: newAttempts,
    lastAttemptTs: Date.now(),
    lockoutUntil,
    pbkdf2Multiplier: multiplier,
    version: 1,
  };

  await writeIDB(fingerprint, newState);

  const lsStore = readLocalStorage();
  lsStore[fingerprint] = newState;
  writeLocalStorage(lsStore);

  const ssStore = readSessionStorage();
  ssStore[fingerprint] = {
    attempts: newSessionAttempts,
    startedAt: ssStore[fingerprint]?.startedAt ?? Date.now(),
  };
  writeSessionStorage(ssStore);

  return newState;
}

export async function recordSuccessfulAttempt(fingerprint) {
  const clearedState = {
    failedAttempts: 0,
    lastAttemptTs: Date.now(),
    lockoutUntil: 0,
    pbkdf2Multiplier: 1,
    version: 1,
  };

  await writeIDB(fingerprint, clearedState);

  const lsStore = readLocalStorage();
  delete lsStore[fingerprint];
  writeLocalStorage(lsStore);

  const ssStore = readSessionStorage();
  delete ssStore[fingerprint];
  writeSessionStorage(ssStore);
}

export function getEscalatedIterations(baseIterations, multiplier) {
  return Math.min(baseIterations * multiplier, baseIterations * PBKDF2_MAX_MULTIPLIER);
}

export function getPoWChallenge(fingerprint, attemptCount) {
  if (attemptCount < POW_THRESHOLD) return null;

  const difficulty = Math.min(
    POW_BASE_DIFFICULTY + (attemptCount - POW_THRESHOLD) * POW_DIFFICULTY_STEP,
    POW_MAX_DIFFICULTY
  );

  const challenge = new Uint8Array(16);
  crypto.getRandomValues(challenge);

  return { challenge: Array.from(challenge), difficulty };
}

export async function computeProofOfWork(challenge, difficulty) {
  const challengeBytes = new Uint8Array(challenge);
  let nonce = 0;
  const maxNonce = 2 ** 32;

  while (nonce < maxNonce) {
    const nonceBytes = new Uint8Array(4);
    nonceBytes[0] = (nonce >>> 24) & 0xff;
    nonceBytes[1] = (nonce >>> 16) & 0xff;
    nonceBytes[2] = (nonce >>> 8) & 0xff;
    nonceBytes[3] = nonce & 0xff;

    const combined = new Uint8Array(challengeBytes.length + 4);
    combined.set(challengeBytes);
    combined.set(nonceBytes, challengeBytes.length);

    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', combined));

    let leadingZeros = 0;
    for (const byte of hash) {
      if (byte === 0) { leadingZeros += 8; }
      else {
        let b = byte;
        while (!(b & 0x80)) { leadingZeros++; b <<= 1; }
        break;
      }
    }

    if (leadingZeros >= difficulty) {
      return { nonce, hash: Array.from(hash) };
    }

    nonce++;

    if (nonce % 10000 === 0) {
      await new Promise(r => setTimeout(r, 0));
    }
  }

  throw new Error('Proof of work failed');
}

function readPwdLocalStorage() {
  try { return JSON.parse(localStorage.getItem(PWD_LOCKOUT_LS_KEY) || '{}'); }
  catch { return {}; }
}

function writePwdLocalStorage(store) {
  try { localStorage.setItem(PWD_LOCKOUT_LS_KEY, JSON.stringify(store)); }
  catch { /* mirror write failed; other mirrors still gate attempts */ }
}

function readPwdSessionStorage() {
  try { return JSON.parse(sessionStorage.getItem(PWD_LOCKOUT_SS_KEY) || '{}'); }
  catch { return {}; /* degraded mirror = empty, others hold state */ }
}

function writePwdSessionStorage(store) {
  try { sessionStorage.setItem(PWD_LOCKOUT_SS_KEY, JSON.stringify(store)); }
  catch { /* mirror write failed; other mirrors still gate attempts */ }
}

async function readPwdIDB(accountId) {
  try {
    const record = await db.settings.get(PWD_IDB_PREFIX + accountId);
    return record?.value || null;
  } catch { return null; /* degraded mirror, others hold state */ }
}

async function writePwdIDB(accountId, state) {
  try {
    await db.settings.put({ key: PWD_IDB_PREFIX + accountId, value: state });
  } catch { /* mirror write failed; other mirrors still gate attempts */ }
}

export async function getPwdLockoutState(accountId) {
  const idbState = await readPwdIDB(accountId);
  const lsStore = readPwdLocalStorage();
  const lsState = lsStore[accountId] || null;
  const ssStore = readPwdSessionStorage();
  const ssState = ssStore[accountId] || null;

  const maxAttempts = Math.max(
    idbState?.failedAttempts ?? 0,
    lsState?.failedAttempts ?? 0
  );
  const maxLockoutUntil = Math.max(
    idbState?.lockoutUntil ?? 0,
    lsState?.lockoutUntil ?? 0
  );

  // Fold in the pre-V2 inline unlock system ('mv_cumulative_attempts' in
  // localStorage + 'lockoutData:<id>' in IDB) so a returning user's
  // accumulated failures gate their FIRST V2 unlock attempt, not only
  // later ones. Take the max, never reset. Legacy keys are removed by
  // recordPwdSuccessfulAttempt / recordPwdFailedAttempt writes.
  const legacy = await readLegacyUnlockState(accountId);

  return {
    failedAttempts: Math.max(maxAttempts, legacy.failedAttempts),
    lockoutUntil: Math.max(maxLockoutUntil, legacy.lockoutUntil),
    sessionAttempts: ssState?.attempts ?? 0,
  };
}

// Pre-V2 LockScreen tracked unlock failures in its own two stores with its
// own (weaker) tier table. V2 reads them once per state check until the
// first successful unlock clears the keys for good.
async function readLegacyUnlockState(accountId) {
  let failedAttempts = 0;
  let lockoutUntil = 0;

  try {
    const legacyLs = JSON.parse(localStorage.getItem('mv_cumulative_attempts') || '{}');
    failedAttempts = Math.max(failedAttempts, legacyLs[accountId]?.attempts ?? 0);
  } catch {
    // Unreadable legacy state is treated as empty — it can only make the
    // account MORE protected, and a parse failure must not break unlocks.
  }

  try {
    const legacyIdb = await db.settings.get('lockoutData:' + accountId);
    failedAttempts = Math.max(failedAttempts, legacyIdb?.value?.failedAttempts ?? 0);
    lockoutUntil = Math.max(lockoutUntil, legacyIdb?.value?.endTime ?? 0);
  } catch {
    // Same policy as above.
  }

  return { failedAttempts, lockoutUntil };
}

async function clearLegacyUnlockState(accountId) {
  try {
    const legacyLs = JSON.parse(localStorage.getItem('mv_cumulative_attempts') || '{}');
    delete legacyLs[accountId];
    localStorage.setItem('mv_cumulative_attempts', JSON.stringify(legacyLs));
  } catch { /* best-effort; unreadable legacy state is already inert */ }
  try {
    await db.settings.delete('lockoutData:' + accountId);
  } catch { /* same */ }
}


export async function checkPwdLockout(accountId) {
  const state = await getPwdLockoutState(accountId);

  if (state.sessionAttempts >= SESSION_HARD_CAP) {
    return {
      locked: true,
      reason: 'session_limit',
      retryAfter: Infinity,
    };
  }

  if (Date.now() < state.lockoutUntil) {
    return {
      locked: true,
      reason: 'time_lockout',
      retryAfter: state.lockoutUntil - Date.now(),
    };
  }

  return { locked: false };
}

export async function recordPwdFailedAttempt(accountId) {
  const state = await getPwdLockoutState(accountId);
  const newAttempts = state.failedAttempts + 1;
  const newSessionAttempts = state.sessionAttempts + 1;

  let lockoutUntil = 0;
  for (const tier of LOCKOUT_TIERS) {
    if (newAttempts >= tier.threshold) {
      lockoutUntil = Date.now() + tier.duration;
    }
  }

  const newState = {
    failedAttempts: newAttempts,
    lastAttemptTs: Date.now(),
    lockoutUntil,
    version: 1,
  };

  await writePwdIDB(accountId, newState);

  const lsStore = readPwdLocalStorage();
  lsStore[accountId] = newState;
  writePwdLocalStorage(lsStore);

  // The merged count is now authoritative in the pwd-lockout stores; drop
  // the legacy keys so future reads don't keep re-counting them.
  await clearLegacyUnlockState(accountId);

  const ssStore = readPwdSessionStorage();
  ssStore[accountId] = {
    attempts: newSessionAttempts,
    startedAt: ssStore[accountId]?.startedAt ?? Date.now(),
  };
  writePwdSessionStorage(ssStore);

  return newState;
}

export async function recordPwdSuccessfulAttempt(accountId) {
  const clearedState = {
    failedAttempts: 0,
    lastAttemptTs: Date.now(),
    lockoutUntil: 0,
    version: 1,
  };

  await writePwdIDB(accountId, clearedState);

  const lsStore = readPwdLocalStorage();
  delete lsStore[accountId];
  writePwdLocalStorage(lsStore);

  const ssStore = readPwdSessionStorage();
  delete ssStore[accountId];
  writePwdSessionStorage(ssStore);

  // Success means the verified user is back — legacy and new state both
  // reset so the merge in getPwdLockoutState stops finding old counters.
  await clearLegacyUnlockState(accountId);
}

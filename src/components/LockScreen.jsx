import { useState, useEffect, useRef, useCallback } from 'react';
import { deriveKey, generateSalt, createVerificationToken, verifyPassword, setSessionKey, encryptTransactionForStorage, decryptTransactionFromStorage, PBKDF2_ITERATIONS } from '../crypto/crypto';
import { db } from '../db/db';
import { useLanguage } from '../context/LanguageContext';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';

const ATTEMPT_STORAGE_KEY = 'mv_cumulative_attempts';

const getLockoutDuration = (attempts) => {
  if (attempts >= 20) return 10 * 60 * 1000;
  if (attempts >= 15) return 5 * 60 * 1000;
  if (attempts >= 10) return 2 * 60 * 1000;
  if (attempts >= 5)  return 30 * 1000;
  return 0;
};

const getLocalAttempts = (accountId) => {
  try {
    const stored = JSON.parse(localStorage.getItem(ATTEMPT_STORAGE_KEY) || '{}');
    return stored[accountId]?.attempts || 0;
  } catch { return 0; }
};

const setLocalAttempts = (accountId, attempts) => {
  try {
    const stored = JSON.parse(localStorage.getItem(ATTEMPT_STORAGE_KEY) || '{}');
    stored[accountId] = { attempts, lastAttempt: Date.now() };
    localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(stored));
  } catch { }
};

const clearLocalAttempts = (accountId) => {
  try {
    const stored = JSON.parse(localStorage.getItem(ATTEMPT_STORAGE_KEY) || '{}');
    delete stored[accountId];
    localStorage.setItem(ATTEMPT_STORAGE_KEY, JSON.stringify(stored));
  } catch { }
};

const upgradePbkdf2Iterations = async (accountId, password) => {
  try {
    const salt = await db.settings.get('salt:' + accountId);
    if (!salt) return;

    const saltArray = new Uint8Array(Object.values(salt.value));
    const oldKey = await deriveKey(password, saltArray, 200000);
    const newSalt = generateSalt();
    const newKey = await deriveKey(password, newSalt, PBKDF2_ITERATIONS);

    const allEncrypted = await db.transactions.where('accountId').equals(accountId).toArray();
    const reEncrypted = [];
    for (const tx of allEncrypted) {
      try {
        const plain = await decryptTransactionFromStorage(tx, oldKey);
        const encrypted = await encryptTransactionForStorage(plain, newKey);
        encrypted.accountId = accountId;
        reEncrypted.push(encrypted);
      } catch { }
    }

    const newToken = await createVerificationToken(newKey);

    await db.transaction('rw', db.transactions, db.settings, async () => {
      await db.transactions.where('accountId').equals(accountId).delete();
      await db.transactions.bulkAdd(reEncrypted);
      await db.settings.put({ key: 'salt:' + accountId, value: Array.from(newSalt) });
      await db.settings.put({ key: 'verificationToken:' + accountId, value: newToken });
      await db.settings.put({ key: 'pbkdf2Version:' + accountId, value: PBKDF2_ITERATIONS });
    });

    setSessionKey(newKey, accountId);
  } catch { }
};

const LockScreen = ({ accountId, onUnlock, onBack }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [isLockedOut, setIsLockedOut] = useState(false);
  const [lockoutEndTime, setLockoutEndTime] = useState(null);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [tokenMissing, setTokenMissing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [resetConfirmStep, setResetConfirmStep] = useState(0);
  const [resetConfirmName, setResetConfirmName] = useState('');
  const [accountDisplayName, setAccountDisplayName] = useState('');
  const [isFirstTime, setIsFirstTime] = useState(false);
  const passwordInputRef = useRef(null);
  const intervalRef = useRef(null);
  const { t } = useLanguage();

  useEffect(() => {
    const checkLockoutStatus = async () => {
      try {
        const account = await db.accounts.get(accountId);
        if (account) setAccountDisplayName(account.name);
      } catch { }

      try {
        const passwordSet = await db.settings.get('passwordSet:' + accountId);
        if (!passwordSet) setIsFirstTime(true);
      } catch { }

      try {
        const lockoutData = await db.settings.get('lockoutData:' + accountId);
        const localAttempts = getLocalAttempts(accountId);
        let maxAttempts = 0;
        let existingEndTime = 0;

        if (lockoutData?.value) {
          maxAttempts = lockoutData.value.failedAttempts || 0;
          existingEndTime = lockoutData.value.endTime || 0;
        }

        maxAttempts = Math.max(maxAttempts, localAttempts);

        const currentTime = Date.now();
        if (existingEndTime > currentTime) {
          setIsLockedOut(true);
          setLockoutEndTime(existingEndTime);
          setFailedAttempts(maxAttempts);
        } else {
          setFailedAttempts(maxAttempts);
        }
      } catch { }
    };

    checkLockoutStatus();
  }, [accountId]);

  useEffect(() => {
    if (isLockedOut && lockoutEndTime) {
      intervalRef.current = setInterval(() => {
        const currentTime = Date.now();
        setNow(currentTime);
        if (currentTime >= lockoutEndTime) {
          setIsLockedOut(false);
          setLockoutEndTime(null);
          db.settings.put({
            key: 'lockoutData:' + accountId,
            value: { endTime: 0, failedAttempts }
          }).catch(() => {});
        }
      }, 1000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isLockedOut, lockoutEndTime, failedAttempts, accountId]);

  const handleUnlock = async (e) => {
    e.preventDefault();

    if (isLockedOut) {
      setError(t('lock.errors.locked'));
      return;
    }

    if (!password) {
      setError(t('lock.errors.emptyPassword'));
      return;
    }

    if (password.length < 4) {
      setError(t('lock.errors.tooShort'));
      return;
    }

    try {
      const passwordSet = await db.settings.get('passwordSet:' + accountId);

      if (passwordSet) {
        const salt = await db.settings.get('salt:' + accountId);
        if (!salt) {
          setError(t('lock.errors.corrupted'));
          return;
        }

        const saltArray = new Uint8Array(Object.values(salt.value));

        const token = await db.settings.get('verificationToken:' + accountId);
        if (!token) {
          setTokenMissing(true);
          setError(t('lock.errors.tokenMissing'));
          return;
        }

        const iterVersion = await db.settings.get('pbkdf2Version:' + accountId).catch(() => null);
        const storedIterations = iterVersion?.value || 200000;
        const key = await deriveKey(password, saltArray, storedIterations);

        const isValid = await verifyPassword(key, token.value);

        if (isValid) {
          setFailedAttempts(0);
          clearLocalAttempts(accountId);
          await db.settings.put({
            key: 'lockoutData:' + accountId,
            value: { endTime: 0, failedAttempts: 0 }
          }).catch(() => {});
          setSessionKey(key, accountId);
          setPassword('');
          setIsUnlocking(true);

          if (storedIterations < PBKDF2_ITERATIONS) {
            upgradePbkdf2Iterations(accountId, password).catch(() => {});
          }

          setTimeout(() => onUnlock(), 500);
        } else {
          const newFailedAttempts = failedAttempts + 1;
          setFailedAttempts(newFailedAttempts);
          setLocalAttempts(accountId, newFailedAttempts);

          const lockoutDuration = getLockoutDuration(newFailedAttempts);
          const lockoutValue = {
            endTime: lockoutDuration > 0 ? Date.now() + lockoutDuration : 0,
            failedAttempts: newFailedAttempts
          };
          await db.settings.put({
            key: 'lockoutData:' + accountId,
            value: lockoutValue
          }).catch(() => {});

          if (lockoutDuration > 0) {
            setIsLockedOut(true);
            setLockoutEndTime(lockoutValue.endTime);
            setError(t('lock.errors.tooManyAttempts'));
          } else {
            setError(t('lock.errors.invalid'));
          }
          setPassword('');
        }
      } else {
        const salt = generateSalt();
        await db.settings.put({ key: 'salt:' + accountId, value: Array.from(salt) });

        const key = await deriveKey(password, salt);
        const token = await createVerificationToken(key);
        await db.settings.put({ key: 'verificationToken:' + accountId, value: token });
        await db.settings.put({ key: 'passwordSet:' + accountId, value: true });
        await db.settings.put({ key: 'pbkdf2Version:' + accountId, value: PBKDF2_ITERATIONS });

        setSessionKey(key, accountId);
        setPassword('');
        setIsUnlocking(true);
        setTimeout(() => onUnlock(), 500);
      }
    } catch {
      setError(t('lock.errors.unlockFailed'));
      setPassword('');
    }
  };

  const handleResetAccount = () => {
    if (resetConfirmStep === 0) {
      setResetConfirmStep(1);
      return;
    }

    if (resetConfirmStep === 1) {
      if (resetConfirmName.trim() !== accountDisplayName.trim()) {
        setError(t('lock.resetNameMismatch'));
        return;
      }
      performReset();
    }
  };

  const performReset = async () => {
    try {
      await db.transactions.where('accountId').equals(accountId).delete();
      await db.settings.delete('salt:' + accountId);
      await db.settings.delete('verificationToken:' + accountId);
      await db.settings.delete('passwordSet:' + accountId);
      await db.settings.delete('lockoutData:' + accountId);
      clearLocalAttempts(accountId);
      setTokenMissing(false);
      setError('');
      setFailedAttempts(0);
      setIsLockedOut(false);
      setPassword('');
      setResetConfirmStep(0);
      setResetConfirmName('');
      setIsFirstTime(true);
    } catch {
      setError(t('lock.errors.unlockFailed'));
    }
  };

  const cancelReset = () => {
    setResetConfirmStep(0);
    setResetConfirmName('');
    setError('');
  };

  return (
    <div className={`lock-screen ${isUnlocking ? 'unlocking' : ''}`}>
      <div className="lock-screen-container">
        <div className="lock-screen-top-bar">
          <button className="lock-back-button" onClick={onBack} aria-label="Back">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <ThemeToggle />
            <LanguageToggle />
          </div>
        </div>
        <h1>{t('lock.title')}</h1>
        <h2>{isFirstTime ? t('lock.setPassword') : t('lock.subtitle')}</h2>

        {isFirstTime && (
          <div className="first-use-hint">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {t('lock.setPassword')}
          </div>
        )}

        <form onSubmit={handleUnlock} className="lock-screen-form">
          <div className="password-input-container">
            <label htmlFor="password">{t('lock.enterPassword')}</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              ref={passwordInputRef}
              placeholder={t('lock.passwordPlaceholder')}
              disabled={isLockedOut}
              autoComplete={isFirstTime ? 'new-password' : 'current-password'}
            />
          </div>

          {error && <div className="error-message">{error}</div>}

          {isLockedOut && (
            <div className="lockout-timer">
              {t('lock.lockoutTimer', { seconds: Math.ceil((lockoutEndTime - now) / 1000) })}
            </div>
          )}

          <button type="submit" className="unlock-button" disabled={isLockedOut || tokenMissing}>
            {isFirstTime ? t('lock.setPassword') : t('lock.unlock')}
          </button>
        </form>

        {tokenMissing && (
          <div className="reset-account-section">
            {resetConfirmStep === 0 ? (
              <button className="reset-account-btn" onClick={handleResetAccount}>
                {t('lock.resetAccount')}
              </button>
            ) : (
              <div className="reset-confirm-form">
                <p className="reset-confirm-text">
                  {t('lock.resetConfirmType', { name: accountDisplayName })}
                </p>
                <input
                  type="text"
                  value={resetConfirmName}
                  onChange={(e) => setResetConfirmName(e.target.value)}
                  placeholder={accountDisplayName}
                  className="reset-confirm-input"
                  autoFocus
                />
                {error && <div className="error-message">{error}</div>}
                <div className="reset-confirm-actions">
                  <button className="reset-account-btn" onClick={handleResetAccount}>
                    {t('lock.resetConfirm')}
                  </button>
                  <button className="reset-cancel-btn" onClick={cancelReset}>
                    {t('accounts.cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="app-info">
          <p>{t('lock.info.encrypted')}</p>
          <p>{t('lock.info.noServer')}</p>
        </div>
      </div>
    </div>
  );
};

export default LockScreen;

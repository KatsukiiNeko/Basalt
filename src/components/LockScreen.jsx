import { useState, useEffect, useRef } from 'react';
import { db } from '../db/db';
import { setSessionKey, PBKDF2_ITERATIONS } from '../crypto/crypto';
import { fetchAccountAuthState, unlockAttempt, setupPassword, upgradePbkdf2, deleteAccount } from '../services/auth';
import {
  checkPwdLockout,
  getPwdLockoutState,
  recordPwdFailedAttempt,
  recordPwdSuccessfulAttempt,
  getPoWChallenge,
  computeProofOfWork,
} from '../utils/lockout';
import { useLanguage } from '../context/LanguageContext';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';

// Unlock surfaces the same brute-force defenses the backup flow already
// uses (triple-store lockout, escalating PBKDF2, PoW, session hard cap) —
// previously it ran a weaker parallel inline system.

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
      } catch {
        // Name is cosmetic; the unlock flow must proceed without it.
      }

      try {
        const { isFirstTime } = await fetchAccountAuthState(accountId);
        if (isFirstTime) setIsFirstTime(true);
      } catch {
        // If auth settings are unreadable the unlock path below surfaces
        // the corruption explicitly; nothing to do here.
      }

      try {
        const verdict = await checkPwdLockout(accountId);
        if (verdict.locked && verdict.reason === 'time_lockout') {
          setIsLockedOut(true);
          setLockoutEndTime(Date.now() + verdict.retryAfter);
        }
        const state = await getPwdLockoutState(accountId);
        setFailedAttempts(state.failedAttempts);
      } catch {
        // A lockout-engine failure must not block presenting the unlock
        // form; the engine writes still take effect on the next attempt.
      }
    };

    checkLockoutStatus();
  }, [accountId]);

  useEffect(() => {
    if (isLockedOut && lockoutEndTime) {
      intervalRef.current = setInterval(() => {
        const currentTime = Date.now();
        setNow(currentTime);
        if (currentTime >= lockoutEndTime) {
          // The lockout engine owns persistence; expiry here is purely a
          // countdown display state — the next attempt re-checks the engine.
          setIsLockedOut(false);
          setLockoutEndTime(null);
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

    // Pre-attempt gate: lockout tiers, session cap, and escalated PBKDF2.
    const gate = await checkPwdLockout(accountId);
    if (gate.locked) {
      if (gate.reason === 'session_limit') {
        setError(t('lock.errors.tooManyAttempts'));
      } else {
        setIsLockedOut(true);
        setLockoutEndTime(Date.now() + gate.retryAfter);
        setError(t('lock.errors.tooManyAttempts'));
      }
      return;
    }

    const preState = await getPwdLockoutState(accountId);

    // Repeated failures must cost real work: proof-of-work from the 10th
    // attempt in the session, same escalating difficulty as backup restore.
    const pow = getPoWChallenge(accountId, preState.failedAttempts);
    if (pow) {
      setIsUnlocking(true);
      try {
        await computeProofOfWork(pow.challenge, pow.difficulty);
      } catch {
        setError(t('lock.errors.unlockFailed'));
        setIsUnlocking(false);
        return;
      }
      setIsUnlocking(false);
    }

    try {
      const { isFirstTime } = await fetchAccountAuthState(accountId);

      if (!isFirstTime) {
        // Verification always derives at the vault's stored iteration count —
        // escalation here would break legitimate unlocks (the stored token
        // can only be decrypted by the exact key). Attackers pay through
        // the tier lockouts, session cap, and PoW above instead.
        const attempt = await unlockAttempt(accountId, password);

        if (attempt.isValid) {
          await recordPwdSuccessfulAttempt(accountId);
          setSessionKey(attempt.key, accountId);
          setPassword('');
          setIsUnlocking(true);

          if (attempt.storedIterations < PBKDF2_ITERATIONS) {
            // Old vaults upgrade to the current standard on unlock; the
            // rekey aborts (never partially applies) if any row is corrupt.
            upgradePbkdf2(accountId, attempt.key, password).catch(() => {
              // A failed upgrade leaves the vault on the old iterations —
              // still fully usable, upgraded on a later session.
            });
          }

          setTimeout(() => onUnlock(), 500);
        } else {
          await recordPwdFailedAttempt(accountId);
          const newState = await getPwdLockoutState(accountId);

          if (newState.lockoutUntil > Date.now()) {
            setIsLockedOut(true);
            setLockoutEndTime(newState.lockoutUntil);
            setError(t('lock.errors.tooManyAttempts'));
          } else {
            setError(t('lock.errors.invalid'));
          }
          setPassword('');
        }
      } else {
        // First-time setup: derive fresh salt + token at the current standard.
        await setupPassword(accountId, password);
        setPassword('');
        setIsUnlocking(true);
        setTimeout(() => onUnlock(), 500);
      }
    } catch (err) {
      if (err?.message === 'TOKEN_MISSING') {
        setTokenMissing(true);
        setError(t('lock.errors.tokenMissing'));
        return;
      }
      if (err?.message === 'CORRUPTED') {
        setError(t('lock.errors.corrupted'));
        return;
      }
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
      await deleteAccount(accountId);
      await recordPwdSuccessfulAttempt(accountId); // also clears legacy stores
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
          <button className="lock-back-button" onClick={onBack} aria-label={t('toggle.back')}>
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

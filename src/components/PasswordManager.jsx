import { useState, useEffect, useRef } from 'react';
import { deriveKey, generateSalt, setSessionKey, createVerificationToken, verifyPassword, encryptTransactionForStorage, decryptTransactionFromStorage, getActiveAccountId, PBKDF2_ITERATIONS } from '../crypto/crypto';
import { db } from '../db/db';
import { useLanguage } from '../context/LanguageContext';
import {
  checkPwdLockout,
  recordPwdFailedAttempt,
  recordPwdSuccessfulAttempt,
} from '../utils/lockout';

const PasswordManager = ({ onPasswordChange }) => {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [lockoutTimer, setLockoutTimer] = useState(0);
  const lockoutIntervalRef = useRef(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (lockoutTimer > 0) {
      lockoutIntervalRef.current = setInterval(() => {
        setLockoutTimer(prev => {
          if (prev <= 1) {
            clearInterval(lockoutIntervalRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (lockoutIntervalRef.current) clearInterval(lockoutIntervalRef.current);
    };
  }, [lockoutTimer]);

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (lockoutTimer > 0) {
      setError(t('password.errors.cooldown', { seconds: lockoutTimer }));
      return;
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      setError(t('password.errors.required'));
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(t('password.errors.mismatch'));
      return;
    }

    if (newPassword.length < 4) {
      setError(t('password.errors.tooShort'));
      return;
    }

    const accountId = getActiveAccountId();

    const lockout = await checkPwdLockout(accountId);
    if (lockout.locked) {
      if (lockout.reason === 'session_limit') {
        setError(t('password.errors.tooManyAttempts'));
      } else {
        setLockoutTimer(Math.ceil(lockout.retryAfter / 1000));
        setError(t('password.errors.cooldown', { seconds: Math.ceil(lockout.retryAfter / 1000) }));
      }
      return;
    }

    try {
      setIsLoading(true);

      const salt = await db.settings.get('salt:' + accountId);
      const token = await db.settings.get('verificationToken:' + accountId);
      if (!salt || !token) {
        setError(t('password.errors.notSet'));
        setIsLoading(false);
        return;
      }

      const saltArray = new Uint8Array(Object.values(salt.value));
      const oldKey = await deriveKey(currentPassword, saltArray);
      const isValid = await verifyPassword(oldKey, token.value);

      if (!isValid) {
        await recordPwdFailedAttempt(accountId);
        const newLockout = await checkPwdLockout(accountId);
        if (newLockout.locked && newLockout.reason === 'time_lockout') {
          setLockoutTimer(Math.ceil(newLockout.retryAfter / 1000));
        }
        setError(t('password.errors.incorrect'));
        setIsLoading(false);
        return;
      }

      const allEncrypted = await db.transactions.where('accountId').equals(accountId).toArray();
      const decryptedTransactions = [];
      for (const enc of allEncrypted) {
        try {
          const tx = await decryptTransactionFromStorage(enc, oldKey);
          decryptedTransactions.push(tx);
        } catch {
          throw new Error(t('password.errors.decryptFailed'));
        }
      }

      const newSalt = generateSalt();
      const newKey = await deriveKey(newPassword, newSalt);

      const reEncrypted = [];
      for (const tx of decryptedTransactions) {
        const encrypted = await encryptTransactionForStorage(tx, newKey);
        encrypted.accountId = accountId;
        reEncrypted.push(encrypted);
      }

      const newToken = await createVerificationToken(newKey);

      await db.transaction('rw', db.transactions, db.settings, async () => {
        await db.transactions.where('accountId').equals(accountId).delete();
        await db.transactions.bulkAdd(reEncrypted);
        await db.settings.put({ key: 'salt:' + accountId, value: Array.from(newSalt) });
        await db.settings.put({ key: 'verificationToken:' + accountId, value: newToken });
        await db.settings.put({ key: 'passwordSet:' + accountId, value: true });
        await db.settings.put({ key: 'pbkdf2Version:' + accountId, value: PBKDF2_ITERATIONS });
      });

      setSessionKey(newKey, accountId);
      await recordPwdSuccessfulAttempt(accountId);
      setSuccess(t('password.success.changed'));
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (onPasswordChange) onPasswordChange();
    } catch (err) {
      setError(err.message || t('password.errors.changeFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="password-manager">
      <button
        className={`password-manager-toggle ${isExpanded ? 'expanded' : ''}`}
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="toggle-content">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <span>{t('password.toggleLabel')}</span>
        </div>
        <svg className={`chevron ${isExpanded ? 'expanded' : ''}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isExpanded && (
        <form onSubmit={handleChangePassword} className="password-form">
          <div className="password-field">
            <label>{t('password.currentLabel')}</label>
            <div className="input-wrapper">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder={t('password.currentPlaceholder')}
                disabled={isLoading || lockoutTimer > 0}
              />
            </div>
          </div>

          <div className="password-field">
            <label>{t('password.newLabel')}</label>
            <div className="input-wrapper">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
              </svg>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t('password.newPlaceholder')}
                disabled={isLoading || lockoutTimer > 0}
              />
            </div>
          </div>

          <div className="password-field">
            <label>{t('password.confirmLabel')}</label>
            <div className="input-wrapper">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('password.confirmPlaceholder')}
                disabled={isLoading || lockoutTimer > 0}
              />
            </div>
          </div>

          {error && <div className="password-alert error">{error}</div>}
          {success && <div className="password-alert success">{success}</div>}

          {lockoutTimer > 0 && (
            <div className="lockout-timer">
              {t('lock.lockoutTimer', { seconds: lockoutTimer })}
            </div>
          )}

          <button type="submit" className="password-submit-btn" disabled={isLoading || lockoutTimer > 0}>
            {isLoading ? t('password.reEncrypting') : t('password.update')}
          </button>
        </form>
      )}
    </div>
  );
};

export default PasswordManager;

import { useState, useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { PBKDF2_ITERATIONS } from '../crypto/crypto';
import {
  computeBackupFingerprint,
  checkLockout,
  getLockoutState,
  recordFailedAttempt,
  recordSuccessfulAttempt,
  getEscalatedIterations,
  getPoWChallenge,
  computeProofOfWork,
} from '../utils/lockout';
import ConfirmDialog from './ConfirmDialog';

const BackupRestore = ({ onBackup, onSecureBackup, onRestore, onSecureRestore, onExport }) => {
  const [mode, setMode] = useState(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [pendingBackup, setPendingBackup] = useState(null);
  const [restoreMeta, setRestoreMeta] = useState(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const [fingerprint, setFingerprint] = useState(null);
  const [lockoutTimer, setLockoutTimer] = useState(0);
  const [powProgress, setPowProgress] = useState(null);
  const [powElapsed, setPowElapsed] = useState(0);

  const lockoutIntervalRef = useRef(null);
  const { t } = useLanguage();

  useEffect(() => {
    if (pendingBackup && mode === 'secureRestore') {
      const initLockout = async () => {
        try {
          const fp = await computeBackupFingerprint(pendingBackup);
          setFingerprint(fp);
          const lockout = await checkLockout(fp);
          if (lockout.locked && lockout.reason === 'time_lockout') {
            setLockoutTimer(Math.ceil(lockout.retryAfter / 1000));
          }
        } catch {
          // If the fingerprint/lockout read fails we still show the restore
          // form; the submit path re-checks the lockout engine anyway.
        }
      };
      initLockout();
    }
  }, [pendingBackup, mode]);

  useEffect(() => {
    if (lockoutTimer > 0) {
      lockoutIntervalRef.current = setInterval(() => {
        setLockoutTimer(prev => {
          if (prev <= 1) {
            clearInterval(lockoutIntervalRef.current);
            if (fingerprint) {
              checkLockout(fingerprint).then(lockout => {
                if (!lockout.locked) setLockoutTimer(0);
              });
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => { if (lockoutIntervalRef.current) clearInterval(lockoutIntervalRef.current); };
  }, [lockoutTimer, fingerprint]);

  useEffect(() => {
    if (!powProgress) return undefined;
    const interval = setInterval(() => {
      setPowElapsed(Math.ceil((Date.now() - powProgress.startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [powProgress]);

  const resetForm = () => {
    setMode(null);
    setPassword('');
    setConfirmPassword('');
    setError('');
    setStatus('');
    setPendingBackup(null);
    setRestoreMeta(null);
    setFingerprint(null);
    setLockoutTimer(0);
    setPowProgress(null);
    setPowElapsed(0);
  };

  const handleQuickBackup = async () => {
    setIsLoading(true);
    setStatus(t('backup.creating'));
    setError('');
    try {
      await onBackup();
      setStatus(t('backup.success'));
    } catch (err) {
      setError(t('backup.failedPrefix') + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSecureBackupClick = () => {
    resetForm();
    setMode('secureBackup');
  };

  // Export (DR-0009): builds the .xlsx in memory and downloads it. The
  // status/error lines double as the toast: success names the file and
  // row count, empty explains there is nothing to export yet, failures
  // offer a retry by simply pressing the button again.
  const handleExport = async () => {
    if (!onExport) return;
    setError('');
    setStatus('');
    setIsExporting(true);
    try {
      const result = await onExport();
      if (result.empty) {
        setStatus(t('export.empty'));
      } else {
        setStatus(t('export.success', { filename: result.filename, count: result.count }));
      }
    } catch (err) {
      setError(err.code === 'ROW_LIMIT' ? t('export.rowLimit') : t('export.failedPrefix') + err.message);
    } finally {
      setIsExporting(false);
    }
  };

  const handleSecureBackupSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password || password.length < 8) {
      setError(t('backup.passwordTooShort'));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('backup.passwordMismatch'));
      return;
    }

    setIsLoading(true);
    setStatus(t('backup.creating'));
    try {
      await onSecureBackup(password);
      setStatus(t('backup.success'));
      setMode(null);
    } catch (err) {
      setError(t('backup.failedPrefix') + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleRestoreClick = () => {
    setShowConfirm(true);
  };

  const handleConfirmRestore = async () => {
    setShowConfirm(false);
    setIsLoading(true);
    setStatus(t('backup.restoreStarted'));
    setError('');

    try {
      const result = await onRestore();

      if (result.format === 'secure' || result.format === 'legacy') {
        setPendingBackup(result.backup);
        setRestoreMeta(result.meta || null);
        setMode('secureRestore');
        setStatus('');
      } else if (result.format === 'quick') {
        setStatus(t('backup.restoreSuccess', { count: result.count }));
      }
    } catch (err) {
      setError(t('backup.failedRestorePrefix') + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSecureRestoreSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!password || password.length < 8) {
      setError(t('backup.passwordTooShort'));
      return;
    }

    if (!fingerprint) {
      setError(t('backup.failedRestorePrefix') + 'Unable to verify backup');
      return;
    }

    const lockout = await checkLockout(fingerprint);
    if (lockout.locked) {
      if (lockout.reason === 'session_limit') {
        setError(t('backup.lockout.session_limit'));
      } else {
        setLockoutTimer(Math.ceil(lockout.retryAfter / 1000));
        setError(t('backup.lockout.time_lockout', { seconds: Math.ceil(lockout.retryAfter / 1000) }));
      }
      return;
    }

    const state = await getLockoutState(fingerprint);
    const pow = getPoWChallenge(fingerprint, state.failedAttempts);
    if (pow) {
      setPowProgress({ difficulty: pow.difficulty, startedAt: Date.now() });
      try {
        await computeProofOfWork(pow.challenge, pow.difficulty);
      } catch {
        setError(t('backup.powFailed'));
        setPowProgress(null);
        return;
      }
      setPowProgress(null);
    }

    setIsLoading(true);
    setStatus(t('backup.restoring'));

    try {
      const iterations = getEscalatedIterations(
        pendingBackup.iterations || PBKDF2_ITERATIONS,
        state.pbkdf2Multiplier
      );

      if (state.pbkdf2Multiplier > 1) {
        setStatus(t('backup.escalatedDeriving'));
      }

      const count = await onSecureRestore(pendingBackup, password, iterations);
      await recordSuccessfulAttempt(fingerprint);
      setStatus(t('backup.restoreSuccess', { count }));
      resetForm();
    } catch (err) {
      await recordFailedAttempt(fingerprint);
      const newLockout = await checkLockout(fingerprint);
      if (newLockout.locked && newLockout.reason === 'time_lockout') {
        setLockoutTimer(Math.ceil(newLockout.retryAfter / 1000));
      }
      setError(t('backup.failedRestorePrefix') + err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (mode === 'secureBackup' || mode === 'secureRestore') {
    const isBackup = mode === 'secureBackup';
    return (
      <div className="backup-restore">
        <h2>{isBackup ? t('backup.secureBackupTitle') : t('backup.secureRestoreTitle')}</h2>

        {restoreMeta?.accountName && (
          <div className="backup-meta">
            <span className="backup-meta-label">{t('backup.accountName')}:</span>
            <span className="backup-meta-value">{restoreMeta.accountName}</span>
          </div>
        )}
        {restoreMeta?.timestamp && (
          <div className="backup-meta">
            <span className="backup-meta-label">{t('backup.backupDate')}:</span>
            <span className="backup-meta-value">{new Date(restoreMeta.timestamp).toLocaleDateString()}</span>
          </div>
        )}

        <form onSubmit={isBackup ? handleSecureBackupSubmit : handleSecureRestoreSubmit} className="backup-password-form">
          <div className="backup-password-field">
            <label>{t('backup.enterPassword')}</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('backup.passwordPlaceholder')}
              disabled={isLoading || lockoutTimer > 0 || !!powProgress}
              autoComplete="off"
              autoFocus
            />
          </div>

          {isBackup && (
            <div className="backup-password-field">
              <label>{t('backup.confirmPassword')}</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder={t('backup.confirmPlaceholder')}
                disabled={isLoading}
                autoComplete="off"
              />
            </div>
          )}

          {error && <div className="error-message">{error}</div>}
          {status && <div className="status-message">{status}</div>}

          {lockoutTimer > 0 && !isBackup && (
            <div className="lockout-timer">
              {t('lock.lockoutTimer', { seconds: lockoutTimer })}
            </div>
          )}

          {powProgress && (
            <div className="status-message">
              {t('backup.powProgress', { seconds: powElapsed })}
            </div>
          )}

          <div className="backup-form-actions">
            <button type="submit" className="backup-button" disabled={isLoading || lockoutTimer > 0 || !!powProgress}>
              {isLoading ? t('backup.processing') : (isBackup ? t('backup.createBtn') : t('backup.restoreBtn'))}
            </button>
            <button type="button" className="backup-cancel-btn" onClick={resetForm} disabled={isLoading}>
              {t('accounts.cancel')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="backup-restore">
      <h2>{t('backup.title')}</h2>
      <div className="backup-restore-buttons">
        <button
          onClick={handleQuickBackup}
          disabled={isLoading}
          className="backup-button"
        >
          {isLoading && !mode ? t('backup.backupBtnLoading') : t('backup.backupBtn')}
        </button>
        <button
          onClick={handleSecureBackupClick}
          disabled={isLoading}
          className="backup-button secure"
        >
          {t('backup.secureBackupBtn')}
        </button>
        <button
          onClick={handleRestoreClick}
          disabled={isLoading}
          className="restore-button"
        >
          {isLoading && !mode ? t('backup.restoreBtnLoading') : t('backup.restoreBtn')}
        </button>
        <button
          type="button"
          onClick={handleExport}
          disabled={isLoading || isExporting}
          aria-busy={isExporting}
          className="backup-button export-button"
        >
          {isExporting && (
            <span className="spinner export-spinner" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </span>
          )}
          {isExporting ? t('export.exporting') : t('export.button')}
        </button>
      </div>
      {error && <div className="error-message" role="alert">{error}</div>}
      {status && <div className="status-message" role="status">{status}</div>}
      <p className="export-privacy-note">{t('export.privacyNotice')}</p>

      {showConfirm && (
        <ConfirmDialog
          title={t('confirm.restore')}
          message={t('confirm.restoreMessage')}
          onConfirm={handleConfirmRestore}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
};

export default BackupRestore;

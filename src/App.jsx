import { useState, useEffect, useRef, useCallback } from 'react';
import AccountSelector from './components/AccountSelector';
import LockScreen from './components/LockScreen';
import Dashboard from './components/Dashboard';
import { clearSessionKey } from './crypto/crypto';
import { useLanguage } from './context/LanguageContext';
import { db } from './db/db';

const SESSION_TIMEOUT = 15 * 60 * 1000;
const LAST_ACCOUNT_KEY = 'basalt-last-account';

function App() {
  const [accountId, setAccountId] = useState(null);
  const [isLocked, setIsLocked] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const { t } = useLanguage();
  const timeoutRef = useRef(null);

  useEffect(() => {
    const checkAccounts = async () => {
      try {
        await db.accounts.toArray();
      } catch {
        // IndexedDB itself unavailable (rare: private mode, storage full or
        // blocked) is not something we can decide around here, so we don't
        // try — setIsLoading(false) runs either way and we fall through to
        // the account screen, where AccountSelector's own catch keeps the
        // selector usable and the first real write surfaces the error.
        // Blocking on a spinner forever would tell the user less than that.
      }
      setIsLoading(false);
    };
    checkAccounts();
  }, []);

  // Idle lockout: after SESSION_TIMEOUT (15 min) with no activity we drop
  // the session key and re-lock. clearSessionKey() is the entire lock —
  // the key lives only in memory (crypto/sessionKeys.js), so once it is
  // gone nothing here can decrypt the vault again until the password is
  // re-entered at LockScreen.
  //
  // resetTimeout() always clears the previous timer before arming a new
  // one, and only arms while we're unlocked with an account selected, so
  // one can never fire into the lock screen or a half-selected session.
  // The effect below wires it to mousemove/keydown/touchstart/click — the
  // four signals we treat as "someone is still there" — and its cleanup
  // removes those listeners and clears the timer, so neither a lock nor an
  // account switch leaves a stale timeout to lock the next session.
  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    if (!isLocked && accountId) {
      timeoutRef.current = setTimeout(() => {
        clearSessionKey();
        setIsLocked(true);
      }, SESSION_TIMEOUT);
    }
  }, [isLocked, accountId]);

  useEffect(() => {
    if (isLocked) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      return;
    }

    const events = ['mousemove', 'keydown', 'touchstart', 'click'];
    events.forEach((event) => window.addEventListener(event, resetTimeout));
    resetTimeout();

    return () => {
      events.forEach((event) => window.removeEventListener(event, resetTimeout));
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [isLocked, resetTimeout]);

  const handleAccountSelected = (id) => {
    localStorage.setItem(LAST_ACCOUNT_KEY, id);
    setAccountId(id);
    setIsLocked(true);
  };

  const handleUnlock = () => {
    setIsLocked(false);
  };

  const handleLogout = () => {
    clearSessionKey();
    localStorage.removeItem(LAST_ACCOUNT_KEY);
    setAccountId(null);
    setIsLocked(true);
  };

  const handleSwitchAccount = () => {
    clearSessionKey();
    localStorage.removeItem(LAST_ACCOUNT_KEY);
    setAccountId(null);
    setIsLocked(true);
  };

  if (isLoading) {
    return (
      <div className="app">
        <div className="lock-screen">
          <div className="lock-screen-container">
            <div className="spinner" style={{ margin: '2rem auto' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!accountId) {
    return (
      <div className="app">
        <AccountSelector onAccountSelected={handleAccountSelected} />
        <footer className="footer">
          <span>&copy; {t('app.copyright')}</span>
        </footer>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="app">
        <LockScreen accountId={accountId} onUnlock={handleUnlock} onBack={handleSwitchAccount} />
        <footer className="footer">
          <span>&copy; {t('app.copyright')}</span>
        </footer>
      </div>
    );
  }

  return (
    <div className="app">
      <Dashboard onLogout={handleLogout} onSwitchAccount={handleSwitchAccount} />
      <footer className="footer">
        <span>&copy; {t('app.copyright')}</span>
      </footer>
    </div>
  );
}

export default App;

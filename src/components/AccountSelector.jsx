import { useState, useEffect } from 'react';
import { db } from '../db/db';
import { deriveKey, verifyPassword, setActiveAccountId } from '../crypto/crypto';
import { useLanguage } from '../context/LanguageContext';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';

const LAST_ACCOUNT_KEY = 'money-vault-last-account';

const AccountSelector = ({ onAccountSelected }) => {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const { t } = useLanguage();

  const lastUsedId = (() => {
    try { return localStorage.getItem(LAST_ACCOUNT_KEY); } catch { return null; }
  })();

  const loadAccounts = async () => {
    const all = await db.accounts.toArray();
    setAccounts(all);
    setLoading(false);
  };

  useEffect(() => {
    loadAccounts();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');

    if (!newAccountName.trim()) {
      setError(t('accounts.errors.nameRequired'));
      return;
    }

    if (newAccountName.length > 50) {
      setError(t('accounts.errors.nameTooLong'));
      return;
    }

    try {
      const id = crypto.randomUUID();
      await db.accounts.put({
        id,
        name: newAccountName.trim(),
        createdAt: new Date().toISOString()
      });
      setNewAccountName('');
      setIsCreating(false);
      await loadAccounts();
    } catch {
      setError(t('accounts.errors.createFailed'));
    }
  };

  const handleSelect = (accountId) => {
    setSelectedId(accountId);
    setTimeout(() => {
      setActiveAccountId(accountId);
      onAccountSelected(accountId);
    }, 400);
  };

  const handleDelete = async (accountId) => {
    setDeleteError('');
    setDeletingId(accountId);
    setDeletePassword('');
  };

  const confirmDelete = async (accountId) => {
    setDeleteError('');

    if (!deletePassword) {
      setDeleteError(t('lock.errors.emptyPassword'));
      return;
    }

    if (deletePassword.length < 4) {
      setDeleteError(t('lock.errors.tooShort'));
      return;
    }

    try {
      const salt = await db.settings.get('salt:' + accountId);
      const token = await db.settings.get('verificationToken:' + accountId);

      if (salt && token) {
        const saltArray = new Uint8Array(Object.values(salt.value));
        const key = await deriveKey(deletePassword, saltArray);
        const isValid = await verifyPassword(key, token.value);

        if (!isValid) {
          setDeleteError(t('accounts.errors.wrongPassword'));
          return;
        }
      }

      await db.transactions.where('accountId').equals(accountId).delete();
      await db.settings.delete('salt:' + accountId);
      await db.settings.delete('verificationToken:' + accountId);
      await db.settings.delete('passwordSet:' + accountId);
      await db.settings.delete('lockoutData:' + accountId);
      await db.accounts.delete(accountId);

      setDeletingId(null);
      setDeletePassword('');
      await loadAccounts();
    } catch {
      setDeleteError(t('accounts.errors.deleteFailed'));
    }
  };

  const cancelDelete = () => {
    setDeletingId(null);
    setDeletePassword('');
    setDeleteError('');
  };

  const formatDate = (dateString) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="account-selector">
        <div className="account-selector-container">
          <h1>{t('accounts.title')}</h1>
          <div className="empty-state">
            <div className="spinner" style={{ margin: '0 auto' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--primary-light)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`account-selector${selectedId ? ' exiting' : ''}`}>
      <div className="account-selector-container">
        <div className="account-selector-toggle">
          <ThemeToggle />
          <LanguageToggle />
        </div>
        <h1>{t('accounts.title')}</h1>
        <h2>{t('accounts.selectPrompt')}</h2>

        {accounts.length === 0 && !isCreating ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="8.5" cy="7" r="4" />
                <line x1="20" y1="8" x2="20" y2="14" />
                <line x1="23" y1="11" x2="17" y2="11" />
              </svg>
            </div>
            <h4>{t('accounts.empty')}</h4>
            <p>{t('onboarding.getStarted')}</p>
          </div>
        ) : (
          <div className="accounts-list">
            {accounts.map((account, index) => (
              <div
                key={account.id}
                className={`account-item ${account.id === lastUsedId ? 'last-used' : ''}${selectedId === account.id ? ' selected' : ''}${selectedId && selectedId !== account.id ? ' not-selected' : ''}`}
                style={{ animationDelay: `${0.1 + index * 0.1}s` }}
              >
                <div className="account-item-row">
                  <div className="account-item-clickable" onClick={() => !selectedId && handleSelect(account.id)}>
                    <div className="account-item-info">
                      <div className="account-item-name">
                        {account.name}
                        {account.id === lastUsedId && (
                          <span className="last-used-badge">{t('accounts.lastUsed')}</span>
                        )}
                      </div>
                      <div className="account-item-date">
                        {t('accounts.createdAt')}: {formatDate(account.createdAt)}
                      </div>
                    </div>
                  </div>
                  <button
                    className="account-item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(account.id);
                    }}
                    title={t('accounts.delete')}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </button>
                </div>

                {deletingId === account.id && (
                  <div className="delete-confirm">
                    <p>{t('accounts.deleteConfirm', { name: account.name })}</p>
                    <input
                      type="password"
                      value={deletePassword}
                      onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder={t('accounts.deletePasswordPrompt')}
                      autoComplete="current-password"
                    />
                    {deleteError && <div className="error-message">{deleteError}</div>}
                    <div className="delete-confirm-buttons">
                      <button
                        className="delete-confirm-btn confirm"
                        onClick={() => confirmDelete(account.id)}
                      >
                        {t('accounts.delete')}
                      </button>
                      <button
                        className="delete-confirm-btn cancel"
                        onClick={cancelDelete}
                      >
                        {t('accounts.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isCreating ? (
          <form onSubmit={handleCreate} className="create-account-form">
            <label>{t('accounts.createName')}</label>
            <input
              type="text"
              value={newAccountName}
              onChange={(e) => setNewAccountName(e.target.value)}
              placeholder={t('accounts.createNamePlaceholder')}
              maxLength={50}
              autoFocus
            />
            {error && <div className="error-message">{error}</div>}
            <div className="create-account-actions">
              <button type="submit" className="create-account-btn">
                {t('accounts.createBtn')}
              </button>
              <button
                type="button"
                className="create-account-btn cancel"
                onClick={() => {
                  setIsCreating(false);
                  setNewAccountName('');
                  setError('');
                }}
              >
                {t('accounts.cancel')}
              </button>
            </div>
          </form>
        ) : (
          <button className="create-account-btn" onClick={() => setIsCreating(true)}>
            {t('accounts.create')}
          </button>
        )}
      </div>
    </div>
  );
};

export default AccountSelector;

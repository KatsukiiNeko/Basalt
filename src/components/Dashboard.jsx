import { useState, useEffect, useMemo, Suspense, lazy } from 'react';
import { db } from '../db/db';
import { getActiveAccountId, createSecureBackup, restoreSecureBackup, parseSecureBackup } from '../crypto/crypto';
import { computeSummary } from '../services/transactions';
import { createQuickBackup, restoreQuickBackup } from '../services/backup';
import { useVaultData } from '../hooks/useVaultData';
import TransactionForm from './TransactionForm';
import History from './History';
import Forecast from './Forecast';
import OnboardingOverlay from './OnboardingOverlay';
import ThemeToggle from './ThemeToggle';
import LanguageToggle from './LanguageToggle';
import MonthPicker from './MonthPicker';
import { useCurrency } from '../context/CurrencyContext';
import { useLanguage } from '../context/LanguageContext';

// ECharts (~600 KB minified) is the single largest dependency and only the
// dashboard's chart panel needs it. Splitting it keeps the unlock -> vault
// critical path small; the fallback keeps layout stable while it streams in.
const ChartsSection = lazy(() => import('./ChartsSection'));
import SettingsPanel from './SettingsPanel';

// Splits formatMoney output into major/minor parts for the hero display.
// formatMoney appends a currency suffix (" VND" / " USD"), so the minor
// part must be matched inside the numeric body, never against the suffix.
const formatBalanceParts = (amount, formatCurrency) => {
  const formatted = formatCurrency(amount);
  const body = formatted.replace(/ (VND|USD)$/, '');
  const match = body.match(/^(.*?)(\.[\d]{2})?$/);
  if (match) {
    return { major: match[1], minor: match[2] || '' };
  }
  return { major: body, minor: '' };
};

const Dashboard = ({ onLogout, onSwitchAccount }) => {
  const [refreshKey, setRefreshKey] = useState(0);
  const [accountName, setAccountName] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    try { return localStorage.getItem('basalt-onboarded') !== '1'; } catch { return false; }
  });
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const { formatCurrency } = useCurrency();
  const { t } = useLanguage();

  const accountId = getActiveAccountId();

  useEffect(() => {
    const loadAccount = async () => {
      try {
        const account = await db.accounts.get(accountId);
        if (account) setAccountName(account.name);
      } catch {
        // The account row is metadata only — an unreadable name degrades to
        // the empty string, never a broken dashboard.
      }
    };
    loadAccount();
  }, [accountId]);

  // Single decrypted load per (account, refreshKey). Children receive
  // plain records — History/Forecast/ChartsSection no longer each decrypt
  // the full table on their own (three redundant passes per refresh).
  const vault = useVaultData(accountId, refreshKey);
  // Stable empty array keeps useMemo dependencies identity-stable across
  // renders while the vault is still loading.
  const transactions = useMemo(
    () => (vault.status === 'ready' ? vault.transactions : []),
    [vault]
  );
  const summary = useMemo(
    () => computeSummary(transactions, selectedYear, selectedMonth),
    [transactions, selectedYear, selectedMonth]
  );
  const balance = {
    income: summary.monthIncome,
    expenses: summary.monthExpenses,
    totalBalance: summary.totalBalance,
  };
  const monthData = summary.monthsWithData;

  const handleRename = async () => {
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === accountName) {
      setEditingName(false);
      return;
    }
    try {
      await db.accounts.update(accountId, { name: trimmed });
      setAccountName(trimmed);
    } catch {
      // Rename failing leaves the old name in place; the edit simply didn't
      // take. The user sees the previous name and can retry.
    }
    setEditingName(false);
  };

  const startEditing = () => {
    setEditValue(accountName);
    setEditingName(true);
  };

  const handleTransactionAdded = () => {
    setRefreshKey(k => k + 1);
  };

  // History's inline editors save through the transaction service; a save or
  // delete bumps the shared vault so every panel stays consistent.
  const handleHistoryEdited = () => setRefreshKey(k => k + 1);

  const downloadBackup = (backup, suffix) => {
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `basalt-${suffix}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleBackup = async () => {
    const backup = await createQuickBackup(accountId);
    downloadBackup(backup, 'backup');
  };

  const handleSecureBackup = async (password) => {
    const backup = await createSecureBackup(password, accountId);
    downloadBackup(backup, 'secure-backup');
  };

  const readBackupFile = () => {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json';
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) { reject(new Error(t('dashboard.noFileSelected'))); return; }
        try {
          const text = await file.text();
          const backup = JSON.parse(text);
          resolve(backup);
        } catch {
          reject(new Error(t('dashboard.invalidBackupFormat')));
        }
      };
      input.click();
    });
  };

  // Reads a backup file and routes it by version: v3 (secure) and v1
  // (legacy) hand off to BackupRestore's password flow; v2 restores here
  // with the session key.
  const handleRestore = async () => {
    const backup = await readBackupFile();

    if (backup.version === 3) {
      const meta = await parseSecureBackup(backup);
      return { format: 'secure', meta, backup };
    }

    if (backup.version === 2 || !backup.version) {
      const count = await restoreQuickBackup(backup, accountId);
      setRefreshKey(k => k + 1);
      return { format: 'quick', count };
    }

    if (backup.version === 1) {
      return { format: 'legacy', backup };
    }

    throw new Error(t('dashboard.invalidBackupFormat'));
  };

  const handleSecureRestore = async (backup, password, iterations) => {
    const count = await restoreSecureBackup(backup, password, accountId, iterations);
    setRefreshKey(k => k + 1);
    return count;
  };

  const heroParts = formatBalanceParts(balance.totalBalance, formatCurrency);
  const incomeParts = formatBalanceParts(balance.income, formatCurrency);
  const expenseParts = formatBalanceParts(balance.expenses, formatCurrency);

  return (
    <div className="dashboard">
      {showOnboarding && (
        <OnboardingOverlay onComplete={() => setShowOnboarding(false)} />
      )}

      <div className="dashboard-header">
        <div className="dashboard-title-row">
          <h1>{t('dashboard.title')}</h1>
          {editingName ? (
            <div className="account-edit-inline">
              <input
                className="account-edit-input"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename();
                  if (e.key === 'Escape') setEditingName(false);
                }}
                onBlur={handleRename}
                autoFocus
                maxLength={50}
              />
            </div>
          ) : (
            <button className="account-name-badge" onClick={startEditing}>
              <span>{accountName}</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
              </svg>
            </button>
          )}
        </div>
        <div className="header-controls">
          <ThemeToggle />
          <LanguageToggle />
          <button
            className="settings-gear-btn"
            onClick={() => setShowSettings(true)}
            title={t('settings.title')}
            aria-label={t('settings.title')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
          <button onClick={onSwitchAccount} className="switch-account-button">
            {t('accounts.switch')}
          </button>
          <button onClick={onLogout} className="logout-button">
            {t('dashboard.lock')}
          </button>
        </div>
      </div>

      <MonthPicker
        selectedMonth={selectedMonth}
        selectedYear={selectedYear}
        onChange={(m, y) => { setSelectedMonth(m); setSelectedYear(y); }}
        monthData={monthData}
      />

      <div className="hero-balance">
        <div className="hero-balance-label">{t('dashboard.totalBalance')}</div>
        <div className="hero-balance-value">
          {heroParts.major}
          <span className="hero-balance-cents">{heroParts.minor}</span>
        </div>
        <div className="hero-balance-sub">
          <div className="hero-balance-stat">
            <div className="stat-arrow income">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </div>
            <div>
              <div className="stat-label">+ {t('dashboard.income')}</div>
              <div className="stat-value income">{incomeParts.major}<span style={{ fontSize: '0.75em', opacity: 0.7 }}>{incomeParts.minor}</span></div>
            </div>
          </div>
          <div className="hero-balance-stat">
            <div className="stat-arrow expense">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <polyline points="19 12 12 19 5 12" />
              </svg>
            </div>
            <div>
              <div className="stat-label">- {t('dashboard.expenses')}</div>
              <div className="stat-value expense">{expenseParts.major}<span style={{ fontSize: '0.75em', opacity: 0.7 }}>{expenseParts.minor}</span></div>
            </div>
          </div>
        </div>
      </div>

      <div className="dashboard-content">
        <div className="left-column">
          <TransactionForm
            onTransactionAdded={handleTransactionAdded}
          />
        </div>
        <div className="right-column">
          <Forecast
            currentBalance={balance.totalBalance}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            transactions={transactions}
          />
          <Suspense
            fallback={
              <section className="charts-section">
                <div className="chart-card chart-skeleton-card"><div className="chart-skeleton" /></div>
              </section>
            }
          >
            <ChartsSection
              transactions={transactions}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
            />
          </Suspense>
          <History
            key={refreshKey}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            transactions={transactions}
            onEditTransaction={handleHistoryEdited}
          />
        </div>
      </div>

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onBackup={handleBackup}
        onSecureBackup={handleSecureBackup}
        onRestore={handleRestore}
        onSecureRestore={handleSecureRestore}
      />
    </div>
  );
};

export default Dashboard;

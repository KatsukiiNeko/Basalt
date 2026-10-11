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
import { saveBlob } from '../utils/saveFile';

// ECharts (~600 KB minified) is our single largest dependency and only the
// dashboard's chart panel needs it, so we import ChartsSection as a lazy
// chunk: that keeps the unlock -> vault critical path small, and the
// Suspense fallback below holds the layout steady while it streams in.
const ChartsSection = lazy(() => import('./ChartsSection'));
import SettingsPanel from './SettingsPanel';

// Split formatMoney output into major/minor parts for the hero display.
// formatMoney appends a currency suffix (" VND" / " USD"), so the minor
// part has to be matched inside the numeric body, never against the suffix.
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
  const { formatCurrency, currency, vndDisplayMode } = useCurrency();
  const { t } = useLanguage();

  const accountId = getActiveAccountId();

  useEffect(() => {
    const loadAccount = async () => {
      try {
        const account = await db.accounts.get(accountId);
        if (account) setAccountName(account.name);
      } catch {
        // The account row is metadata only — an unreadable name degrades to
        // the empty string rather than taking the whole dashboard down.
      }
    };
    loadAccount();
  }, [accountId]);

  // Our single decrypt pass for this screen: one load per (account,
  // refreshKey), with History/Forecast/ChartsSection reading the plain
  // records it returns. Before this hook each of those panels decrypted the
  // full table itself, so one save meant three redundant passes per refresh.
  const vault = useVaultData(accountId, refreshKey);
  // While the vault is still loading we hand children one stable empty
  // array — a fresh [] on every render would churn their useMemo deps.
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
      // A failed rename leaves the old name in place — the edit simply
      // didn't take, so the user still sees the previous name and can retry.
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
  // delete bumps refreshKey so the shared vault reloads and every panel on
  // this screen re-reads the same data.
  const handleHistoryEdited = () => setRefreshKey(k => k + 1);

  // Download plumbing for the files this screen produces (backup JSON and
  // the exported .xlsx): object URL in, anchor click, URL revoked.
  // downloadBackup calls this directly; the export runs the same trick out
  // of saveBlob in utils/saveFile, behind Chromium's destination dialog.
  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadBackup = (backup, suffix) => {
    const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
    downloadBlob(blob, `basalt-${suffix}-${new Date().toISOString().split('T')[0]}.json`);
  };

  // The XLSX writer ships as a lazy chunk (DR-0008/DR-0009): we import it
  // only on click, and the service worker precaches it so exports still work
  // offline. The destination dialog (Chromium) or the default-download
  // fallback runs here, while the export spinner is still up.
  const handleExport = async () => {
    const { exportWorkbook } = await import('../services/exportService');
    const result = await exportWorkbook({ accountId, currency, vndDisplayMode });
    if (result.empty) return result;
    const outcome = await saveBlob(result.blob, result.filename);
    return { ...result, cancelled: outcome === 'cancelled' };
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

  // Read a backup file and route it by version: v3 (secure) and v1
  // (legacy) hand off to BackupRestore's password flow; v2 restores right
  // here with the session key.
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
          {/* Deliberately no key={refreshKey}: remounting History on every
              save wipes its inline-edit state mid-workflow. Once the vault
              reloads, the changed transactions prop rerenders it in place
              instead. */}
          <History
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
        onExport={handleExport}
      />
    </div>
  );
};

export default Dashboard;

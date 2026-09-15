import { useState } from 'react';
import { updateTransaction, deleteTransaction } from '../services/transactions';
import { useCurrency } from '../context/CurrencyContext';
import { useLanguage } from '../context/LanguageContext';
import { categoryValueToKey, languageLocale } from '../i18n/translations';

const CATEGORY_TYPE_MAP = {
  'Salary': 'income',
  'Investment': 'income',
  'Other Income': 'income',
  'Food & Dining': 'expense',
  'Transportation': 'expense',
  'Shopping': 'expense',
  'Entertainment': 'expense',
  'Bills & Utilities': 'expense',
  'Healthcare': 'expense',
  'Travel': 'expense',
  'Education': 'expense',
  'Gifts & Donations': 'expense',
};

const CATEGORIES = [
  'Food & Dining',
  'Transportation',
  'Shopping',
  'Entertainment',
  'Bills & Utilities',
  'Healthcare',
  'Travel',
  'Education',
  'Gifts & Donations',
  'Salary',
  'Investment',
  'Other Income',
];

const CATEGORY_ICON_MAP = {
  'Food & Dining': { icon: 'food', badge: 'food' },
  'Transportation': { icon: 'transport', badge: 'transport' },
  'Shopping': { icon: 'shopping', badge: 'shopping' },
  'Entertainment': { icon: 'entertainment', badge: 'entertainment' },
  'Bills & Utilities': { icon: 'bills', badge: 'bills' },
  'Healthcare': { icon: 'health', badge: 'health' },
  'Travel': { icon: 'travel', badge: 'travel' },
  'Education': { icon: 'education', badge: 'education' },
  'Gifts & Donations': { icon: 'gifts', badge: 'gifts' },
  'Salary': { icon: 'salary', badge: 'salary' },
  'Investment': { icon: 'investment', badge: 'investment' },
  'Other Income': { icon: 'other', badge: 'other' },
};

const CategoryIcon = ({ category }) => {
  const map = CATEGORY_ICON_MAP[category] || { badge: 'other' };
  return (
    <div className={`category-icon-badge ${map.badge}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {map.icon === 'food' && <><path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><line x1="6" y1="1" x2="6" y2="4"/><line x1="10" y1="1" x2="10" y2="4"/><line x1="14" y1="1" x2="14" y2="4"/></>}
        {map.icon === 'transport' && <><rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></>}
        {map.icon === 'shopping' && <><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></>}
        {map.icon === 'entertainment' && <><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></>}
        {map.icon === 'bills' && <><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>}
        {map.icon === 'health' && <><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></>}
        {map.icon === 'travel' && <><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>}
        {map.icon === 'education' && <><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></>}
        {map.icon === 'gifts' && <><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></>}
        {map.icon === 'salary' && <><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>}
        {map.icon === 'investment' && <><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></>}
        {map.icon === 'other' && <><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>}
      </svg>
    </div>
  );
};

const History = ({ selectedMonth, selectedYear, transactions, onEditTransaction }) => {
  const [deletingId, setDeletingId] = useState(null);
  // Edit workspace model. "editMode" is the persistent workspace toggle — the
  // ONLY way out is the toggle itself; saves, deletes, rerenders and month
  // navigation never exit it. "editingCell" ({ id, field }) holds the single
  // open inline editor; "editDraft + fieldError" drive that editor. Source
  // stays encrypted at rest — the service layer re-encrypts on save; this
  // component only ever handles decrypted records.
  const [editMode, setEditMode] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editDraft, setEditDraft] = useState('');
  // Field-level validation while an inline editor is open. Kept separate from
  // the global `error` banner so a bad value in one field doesn't blank the list.
  const [fieldError, setFieldError] = useState('');
  const [error, setError] = useState('');
  const { formatCurrency } = useCurrency();
  const { t, language } = useLanguage();

  const monthTransactions = transactions
    .filter(tx => {
      const [y, m] = tx.date.split('-').map(Number);
      return m - 1 === selectedMonth && y === selectedYear;
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const handleDelete = async (id) => {
    try {
      await deleteTransaction(id);
      setDeletingId(null);
      onEditTransaction?.();
    } catch {
      setError(t('history.errors.deleteFailed'));
    }
  };

  // The header toggle arms the whole list as an editing workspace. Toggling
  // off is the designated exit: it also closes any open field editor.
  const toggleEditMode = () => {
    if (editMode) {
      setEditingCell(null);
      setEditDraft('');
      setFieldError('');
    }
    setEditMode(!editMode);
  };

  const isEditing = (tx, field) =>
    editMode && editingCell?.id === tx.id && editingCell.field === field;

  // A single click (or Enter/Space on the focused target) opens the editor
  // immediately in edit mode — no double-click, no arming step. Clicking a
  // different field/row simply moves the editor there.
  const openFieldEditor = (tx, field) => {
    if (!editMode) return;
    setFieldError('');
    if (field === 'amount') {
      setEditDraft(tx.amount);
    } else {
      setEditDraft(tx[field] || '');
    }
    setEditingCell({ id: tx.id, field });
  };

  const commitFieldEdit = async (tx, field, valueOverride) => {
    if (editingCell?.id !== tx.id || editingCell.field !== field) return;
    // valueOverride lets callers (e.g. the category <select>) commit the picked
    // value synchronously without depending on a queued setEditDraft.
    const value = valueOverride !== undefined ? valueOverride : editDraft;

    const next = { ...tx };
    if (field === 'amount') {
      if (value === '' || Number.isNaN(Number(value)) || Number(value) <= 0) {
        setFieldError(t('form.errors.invalidAmount'));
        return;
      }
      next.amount = Number(value);
    } else if (field === 'note') {
      next.note = value;
    } else if (field === 'category') {
      next.category = value;
      next.type = CATEGORY_TYPE_MAP[value] || next.type;
    } else if (field === 'date') {
      if (!value) {
        setFieldError(t('form.errors.selectDate'));
        return;
      }
      next.date = value;
    }

    // Close the editor but stay in edit mode — the workspace remains active
    // so the next transaction can be edited with one click.
    setEditingCell(null);
    setEditDraft('');
    setFieldError('');

    try {
      await updateTransaction(tx.id, next, next.accountId);
      onEditTransaction?.();
    } catch (err) {
      // The list stays mounted and the row intact: a failed inline edit must
      // not blank the month's history. Re-open the editor so the typed value
      // survives and the failure is shown next to it.
      setEditingCell({ id: tx.id, field });
      setFieldError(err.code === 'SESSION_EXPIRED'
        ? t('history.errors.sessionExpired')
        : t('history.errors.updateFailed'));
    }
  };

  const cancelFieldEdit = () => {
    setEditingCell(null);
    setEditDraft('');
    setFieldError('');
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString(languageLocale[language] || 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  return (
    <div className="transaction-history">
      <div className="history-header-row">
        <h2>{t('history.title')}</h2>
        <button
          className={`history-edit-toggle${editMode ? ' active' : ''}`}
          onClick={toggleEditMode}
          aria-pressed={editMode}
          title={editMode ? t('history.doneEditing') : t('history.edit')}
        >
          {editMode ? t('history.doneEditing') : t('history.edit')}
        </button>
      </div>

      {editMode && <p className="history-edit-hint">{t('history.editHint')}</p>}

      {error && <div className="error-message" role="alert">{error}</div>}

      {monthTransactions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="8" y1="6" x2="21" y2="6" />
              <line x1="8" y1="12" x2="21" y2="12" />
              <line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" />
              <line x1="3" y1="12" x2="3.01" y2="12" />
              <line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </div>
          <h4>{t('empty.transactions.title')}</h4>
          <p>{t('empty.transactions.desc')}</p>
        </div>
      ) : (
        <div className={`transactions-list${editMode ? ' edit-mode' : ''}`}>
          {monthTransactions.map((transaction) => {
            const openEditor = (field) => openFieldEditor(transaction, field);
            // In edit mode every field is a single-click (and Enter/Space)
            // target; outside edit mode rows stay read-only. The props sit on
            // the editable-target span that the editor REPLACES — so while a
            // cell is open, no "open this cell" handler exists in the tree:
            // clicks inside the editor (caret placement, native select) and
            // the post-commit click can never reseed or re-open the editor.
            const editProps = (field) => (editMode ? {
              role: 'button',
              tabIndex: 0,
              onClick: () => openEditor(field),
              onKeyDown: (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openEditor(field);
                }
              },
            } : {});
            return (
            <div key={transaction.id} className={`transaction-item ${deletingId === transaction.id ? 'deleting' : ''}`}>
              <CategoryIcon category={transaction.category} />
              <div className="transaction-left">
                <div className="transaction-date">
                  {formatDate(transaction.date)}
                </div>
                <div className="transaction-info">
                  <div className="transaction-category editable">
                    {isEditing(transaction, 'category') ? (
                      <>
                        <select
                          className="inline-edit-input"
                          value={editDraft}
                          autoFocus
                          onChange={(e) => commitFieldEdit(transaction, 'category', e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Escape') cancelFieldEdit(); }}
                        >
                          {CATEGORIES.map((c) => (
                            <option key={c} value={c}>
                              {categoryValueToKey[c] ? t(categoryValueToKey[c]) : c}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : (
                      <span className="editable-target" {...editProps('category')}>
                        {categoryValueToKey[transaction.category] ? t(categoryValueToKey[transaction.category]) : transaction.category}
                      </span>
                    )}
                    {isEditing(transaction, 'category') && fieldError && (
                      <span className="inline-edit-error">{fieldError}</span>
                    )}
                  </div>
                  {(transaction.note || editMode) && (
                    <div className="transaction-note editable">
                      {isEditing(transaction, 'note') ? (
                        <span className="inline-editor-wrap">
                          <input
                            className="inline-edit-input"
                            value={editDraft}
                            autoFocus
                            placeholder={t('history.addNoteHint')}
                            onChange={(e) => setEditDraft(e.target.value)}
                            onBlur={() => commitFieldEdit(transaction, 'note')}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitFieldEdit(transaction, 'note');
                              else if (e.key === 'Escape') cancelFieldEdit();
                            }}
                          />
                          {fieldError && <span className="inline-edit-error">{fieldError}</span>}
                        </span>
                      ) : (
                        <span className="editable-target" {...editProps('note')}>
                          {transaction.note || t('history.addNoteHint')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="transaction-right">
                <div className={`transaction-amount ${transaction.type}`}>
                  {isEditing(transaction, 'amount') ? (
                    <span className="inline-editor-wrap">
                      <input
                        className="inline-edit-input amount"
                        type="text"
                        inputMode="decimal"
                        value={editDraft}
                        autoFocus
                        onChange={(e) => setEditDraft(e.target.value)}
                        onBlur={() => commitFieldEdit(transaction, 'amount')}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitFieldEdit(transaction, 'amount');
                          else if (e.key === 'Escape') cancelFieldEdit();
                        }}
                      />
                      {fieldError && <span className="inline-edit-error">{fieldError}</span>}
                    </span>
                  ) : (
                    <span
                      className="editable-target"
                      {...editProps('amount')}
                    >
                      <span className="transaction-direction">{transaction.type === 'expense' ? '-' : '+'}</span>
                      {formatCurrency(transaction.amount)}
                    </span>
                  )}
                </div>
                {deletingId === transaction.id ? (
                  <div className="delete-confirm-inline">
                    <button
                      className="delete-confirm-btn-inline confirm"
                      onClick={() => handleDelete(transaction.id)}
                      title={t('history.deleteConfirm')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </button>
                    <button
                      className="delete-confirm-btn-inline cancel"
                      onClick={() => setDeletingId(null)}
                      title={t('accounts.cancel')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    className="transaction-delete-btn"
                    onClick={() => setDeletingId(transaction.id)}
                    title={t('history.delete')}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      <line x1="10" y1="11" x2="10" y2="17" />
                      <line x1="14" y1="11" x2="14" y2="17" />
                    </svg>
                  </button>
                )}
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default History;

import { useState } from 'react';
import { addTransaction, updateTransaction } from '../services/transactions';
import { getActiveAccountId } from '../crypto/crypto';
import { useLanguage } from '../context/LanguageContext';
import { useCurrency } from '../context/CurrencyContext';
import MoneyInput from './MoneyInput';

const CATEGORY_TYPE_MAP = {
  'Food & Dining': 'expense',
  'Transportation': 'expense',
  'Shopping': 'expense',
  'Entertainment': 'expense',
  'Bills & Utilities': 'expense',
  'Healthcare': 'expense',
  'Travel': 'expense',
  'Education': 'expense',
  'Gifts & Donations': 'expense',
  'Salary': 'income',
  'Investment': 'income',
  'Other Income': 'income',
};

// Shape of the local form state, shared by add and edit modes. Edit mode
// seeds it from the decrypted transaction; add mode starts empty.
const EMPTY_FORM = {
  date: new Date().toISOString().split('T')[0],
  category: '',
  amount: null,
  note: '',
};

const TransactionForm = ({ onTransactionAdded, editingTransaction, onEditFinished }) => {
  // Entering edit mode re-seeds the whole form from the decrypted
  // transaction; leaving it restores a blank add form so a cancelled edit
  // can never leak values into the next transaction. Deriving during render
  // from the identity change (instead of an effect) keeps this synchronous
  // and avoids a cascading extra render.
  const [lastEditingTx, setLastEditingTx] = useState(editingTransaction ?? null);
  const seed = editingTransaction
    ? {
        date: editingTransaction.date,
        category: editingTransaction.category,
        amount: editingTransaction.amount,
        note: editingTransaction.note || '',
      }
    : { ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] };

  const [form, setForm] = useState(seed);
  if (editingTransaction !== lastEditingTx) {
    setLastEditingTx(editingTransaction ?? null);
    setForm(seed);
  }

  // Bumped to remount MoneyInput; its formatted draft is presentation state
  // that the parent cannot set directly (see MoneyInput docs).
  const [amountResetKey, setAmountResetKey] = useState(0);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { t } = useLanguage();
  const { currency, vndDisplayMode } = useCurrency();

  const isEditing = Boolean(editingTransaction);

  const categories = [
    { key: 'foodDining', value: 'Food & Dining' },
    { key: 'transportation', value: 'Transportation' },
    { key: 'shopping', value: 'Shopping' },
    { key: 'entertainment', value: 'Entertainment' },
    { key: 'billsUtilities', value: 'Bills & Utilities' },
    { key: 'healthcare', value: 'Healthcare' },
    { key: 'travel', value: 'Travel' },
    { key: 'education', value: 'Education' },
    { key: 'giftsDonations', value: 'Gifts & Donations' },
    { key: 'salary', value: 'Salary' },
    { key: 'investment', value: 'Investment' },
    { key: 'otherIncome', value: 'Other Income' },
  ];

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!form.category) {
      setError(t('form.errors.selectCategory'));
      return;
    }

    if (form.amount === null || form.amount <= 0) {
      setError(t('form.errors.invalidAmount'));
      return;
    }

    const transaction = {
      date: form.date,
      type: CATEGORY_TYPE_MAP[form.category],
      category: form.category,
      amount: form.amount,
      note: form.note
    };

    setSubmitting(true);
    try {
      if (isEditing) {
        await updateTransaction(editingTransaction.id, transaction, getActiveAccountId());
        setSuccess(t('form.success.updated'));
        onEditFinished?.({ updated: true });
      } else {
        await addTransaction(transaction, getActiveAccountId());
        setSuccess(t('form.success.added'));
        onTransactionAdded?.();
      }
      setError('');

      if (!isEditing) {
        setForm({ ...EMPTY_FORM, date: new Date().toISOString().split('T')[0] });
        setAmountResetKey((k) => k + 1);
      }
    } catch {
      setError(isEditing ? t('form.errors.updateFailed') : t('form.errors.addFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelEdit = () => {
    onEditFinished?.({ cancelled: true });
  };

  return (
    <div className="transaction-form-container">
      <h2>{isEditing ? t('form.editTitle') : t('form.title')}</h2>
      <form onSubmit={handleSubmit} className="transaction-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="date">{t('form.date')}</label>
            <input
              type="date"
              id="date"
              value={form.date}
              onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>{t('form.type')}</label>
            <div className={`type-indicator ${form.category ? CATEGORY_TYPE_MAP[form.category] : ''}`}>
              {form.category ? (CATEGORY_TYPE_MAP[form.category] === 'income' ? t('form.income') : t('form.expense')) : '—'}
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="category">{t('form.category')}</label>
            <select
              id="category"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              required
            >
              <option value="">{t('form.selectCategory')}</option>
              {categories.map((cat) => (
                <option key={cat.value} value={cat.value}>{t(`cat.${cat.key}`)}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="amount">{t('form.amount')}</label>
            <MoneyInput
              // Remounts on edit-mode transitions (seeding the draft) and
              // after each add (clearing it) — never mid-edit.
              key={`${amountResetKey}-${editingTransaction ? editingTransaction.id : 'new'}`}
              id="amount"
              currency={currency}
              initialValue={form.amount == null ? '' : String(form.amount)}
              onChange={(value) => setForm((f) => ({ ...f, amount: value }))}
              placeholder={t('form.amountPlaceholder')}
              required
            />
            {currency === 'VND' && (
              <span className="input-hint">
                {t(vndDisplayMode === 'exact' ? 'form.amountHint.exact' : 'form.amountHint.scaled')}
              </span>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="note">{t('form.note')}</label>
            <input
              type="text"
              id="note"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder={t('form.notePlaceholder')}
              maxLength={500}
            />
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <button type="submit" className="submit-button" disabled={submitting}>
          {isEditing ? t('form.submitEdit') : t('form.submit')}
        </button>
        {isEditing && (
          <button type="button" className="cancel-edit-button" onClick={handleCancelEdit}>
            {t('form.cancelEdit')}
          </button>
        )}
      </form>
    </div>
  );
};

export default TransactionForm;

import { useState } from 'react';
import { db } from '../db/db';
import { getSessionKey, encryptTransactionForStorage, getActiveAccountId } from '../crypto/crypto';
import { useLanguage } from '../context/LanguageContext';
import { useCurrency } from '../context/CurrencyContext';

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

const TransactionForm = ({ onTransactionAdded }) => {
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const { t } = useLanguage();
  const { currency } = useCurrency();

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

    if (!category) {
      setError(t('form.errors.selectCategory'));
      return;
    }

    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) {
      setError(t('form.errors.invalidAmount'));
      return;
    }

    const key = getSessionKey();
    if (!key) {
      setError(t('form.errors.sessionExpired'));
      return;
    }

    const transaction = {
      date: date,
      type: CATEGORY_TYPE_MAP[category],
      category: category,
      amount: parseFloat(amount),
      note: note
    };

    try {
      const encrypted = await encryptTransactionForStorage(transaction, key);
      encrypted.accountId = getActiveAccountId();
      await db.transactions.add(encrypted);
      setSuccess(t('form.success.added'));
      setError('');
      setNote('');
      setAmount('');

      if (onTransactionAdded) {
        onTransactionAdded();
      }
    } catch {
      setError(t('form.errors.addFailed'));
    }
  };

  return (
    <div className="transaction-form-container">
      <h2>{t('form.title')}</h2>
      <form onSubmit={handleSubmit} className="transaction-form">
        <div className="form-row">
          <div className="form-group">
            <label htmlFor="date">{t('form.date')}</label>
            <input
              type="date"
              id="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>{t('form.type')}</label>
            <div className={`type-indicator ${category ? CATEGORY_TYPE_MAP[category] : ''}`}>
              {category ? (CATEGORY_TYPE_MAP[category] === 'income' ? t('form.income') : t('form.expense')) : '—'}
            </div>
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="category">{t('form.category')}</label>
            <select
              id="category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
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
            <input
              type="number"
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              min="0"
              placeholder={t('form.amountPlaceholder')}
              required
            />
            {currency === 'VND' && t('form.amountHint') && (
              <span className="input-hint">{t('form.amountHint')}</span>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="note">{t('form.note')}</label>
            <input
              type="text"
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('form.notePlaceholder')}
              maxLength={500}
            />
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div className="success-message">{success}</div>}

        <button type="submit" className="submit-button">
          {t('form.submit')}
        </button>
      </form>
    </div>
  );
};

export default TransactionForm;

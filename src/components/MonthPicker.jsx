import { useState, useRef, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';

const MONTH_KEYS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

const MonthPicker = ({ selectedMonth, selectedYear, onChange, monthData }) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const [toast, setToast] = useState(null);
  const { t } = useLanguage();
  const dropdownRef = useRef(null);

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const isCurrentMonth = selectedMonth === currentMonth && selectedYear === currentYear;

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const showToast = (message, type) => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const goPrev = () => {
    const newMonth = selectedMonth === 0 ? 11 : selectedMonth - 1;
    const newYear = selectedMonth === 0 ? selectedYear - 1 : selectedYear;
    onChange(newMonth, newYear);
  };

  const goNext = () => {
    if (isCurrentMonth) return;
    const newMonth = selectedMonth === 11 ? 0 : selectedMonth + 1;
    const newYear = selectedMonth === 11 ? selectedYear + 1 : selectedYear;
    onChange(newMonth, newYear);
  };

  const selectMonth = (month) => {
    const isFuture = selectedYear > currentYear || (selectedYear === currentYear && month > currentMonth);
    if (isFuture) {
      showToast(t('monthPicker.futureMessage') || 'Are you from the future?', 'future');
      return;
    }
    const key = `${selectedYear}-${String(month + 1).padStart(2, '0')}`;
    if (monthData && !monthData.has(key)) {
      showToast(t('monthPicker.noData') || 'No transactions recorded this month', 'empty');
    }
    onChange(month, selectedYear);
    setShowDropdown(false);
  };

  const selectYear = (year) => {
    if (year > currentYear) {
      showToast(t('monthPicker.futureMessage') || 'Are you from the future?', 'future');
      return;
    }
    const maxMonth = year === currentYear ? currentMonth : 11;
    const newMonth = selectedMonth > maxMonth ? maxMonth : selectedMonth;
    onChange(newMonth, year);
  };

  const getMonthClass = (i) => {
    const isFutureMonth = selectedYear > currentYear || (selectedYear === currentYear && i > currentMonth);
    const isSelected = i === selectedMonth;
    const key = `${selectedYear}-${String(i + 1).padStart(2, '0')}`;
    const hasData = monthData && monthData.has(key);

    let cls = 'month-grid-btn';
    if (isSelected) cls += ' selected';
    if (isFutureMonth) cls += ' disabled';
    else if (hasData) cls += ' has-data';
    else if (monthData) cls += ' no-data';
    return cls;
  };

  return (
    <>
      {toast && (
        <div className={`month-toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
      <div className="month-picker" ref={dropdownRef}>
        <button
          className="month-picker-arrow"
          onClick={goPrev}
          aria-label={t('toggle.previousMonth')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>

        <button
          className="month-picker-label"
          onClick={() => setShowDropdown(!showDropdown)}
        >
          {t('month.' + MONTH_KEYS[selectedMonth])}, {selectedYear}
        </button>

        <button
          className={`month-picker-arrow ${isCurrentMonth ? 'disabled' : ''}`}
          onClick={goNext}
          aria-label={t('toggle.nextMonth')}
          disabled={isCurrentMonth}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>

        {showDropdown && (
          <div className="month-picker-dropdown">
            <div className="month-picker-year-nav">
              <button onClick={() => selectYear(selectedYear - 1)} className="year-nav-btn">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
              <span className="year-display">{selectedYear}</span>
              <button
                onClick={() => selectYear(selectedYear + 1)}
                className={`year-nav-btn ${selectedYear >= currentYear ? 'disabled' : ''}`}
                disabled={selectedYear >= currentYear}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>
            </div>
            <div className="month-picker-grid">
              {MONTH_KEYS.map((key, i) => (
                <button
                  key={key}
                  className={getMonthClass(i)}
                  onClick={() => selectMonth(i)}
                  title={t('month.' + key)}
                  aria-label={t('month.' + key)}
                >
                  {t('month.short.' + key)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default MonthPicker;

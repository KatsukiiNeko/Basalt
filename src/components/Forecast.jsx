import { useState, useEffect, useRef } from 'react';
import { calculateForecast } from '../utils/forecast';
import { db } from '../db/db';
import { getSessionKey, decryptTransactionFromStorage, getActiveAccountId } from '../crypto/crypto';
import { useCurrency } from '../context/CurrencyContext';
import { useLanguage } from '../context/LanguageContext';

const Forecast = ({ currentBalance = 0, selectedMonth, selectedYear }) => {
  const [forecastData, setForecastData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [correctionFactor, setCorrectionFactor] = useState(null);
  const [editingProjected, setEditingProjected] = useState(false);
  const [editedValue, setEditedValue] = useState('');
  const editInputRef = useRef(null);
  const { formatCurrency } = useCurrency();
  const { t } = useLanguage();

  const correctionKey = `forecastCorrection:${getActiveAccountId()}`;

  useEffect(() => {
    const loadCorrection = async () => {
      try {
        const stored = await db.settings.get(correctionKey);
        if (stored && stored.value) {
          setCorrectionFactor(stored.value);
        }
      } catch {}
    };
    loadCorrection();
  }, [correctionKey]);

  useEffect(() => {
    const loadForecast = async () => {
      try {
        const key = getSessionKey();
        if (!key) {
          setLoading(false);
          return;
        }

        const allEncrypted = await db.transactions.where('accountId').equals(getActiveAccountId()).toArray();
        const transactions = [];
        for (const enc of allEncrypted) {
          try {
            const tx = await decryptTransactionFromStorage(enc, key);
            transactions.push(tx);
          } catch {}
        }

        const currentDate = new Date(selectedYear, selectedMonth, 1);
        const forecast = calculateForecast(transactions, currentBalance, currentDate, correctionFactor);
        setForecastData(forecast);
        setLoading(false);
      } catch {
        setLoading(false);
      }
    };

    loadForecast();
  }, [currentBalance, selectedMonth, selectedYear, correctionFactor]);

  useEffect(() => {
    if (editingProjected && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingProjected]);

  const handleSaveProjected = async () => {
    const numValue = parseFloat(editedValue.replace(/[^0-9.-]/g, ''));
    if (isNaN(numValue) || numValue < 0 || !forecastData) {
      setEditingProjected(false);
      return;
    }

    const modelValue = forecastData.projectedMonthlySpending;
    if (modelValue > 0) {
      const ratio = numValue / modelValue;
      const clampedRatio = Math.max(0.1, Math.min(10, ratio));
      const newCorrection = { ratio: clampedRatio, month: selectedMonth, year: selectedYear };

      try {
        await db.settings.put({ key: correctionKey, value: newCorrection });
        setCorrectionFactor(newCorrection);
      } catch {}
    }

    setEditingProjected(false);
  };

  if (loading) {
    return (
      <div className="forecast-container">
        <h2>{t('forecast.title')}</h2>
        <div className="forecast-content">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton-forecast-item">
              <div className="skeleton skeleton-text" style={{ width: '40%' }} />
              <div className="skeleton skeleton-amount" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!forecastData) {
    return (
      <div className="forecast-container">
        <h2>{t('forecast.title')}</h2>
        <div className="empty-state">
          <div className="empty-state-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <h4>{t('empty.forecast.title')}</h4>
          <p>{t('empty.forecast.desc')}</p>
        </div>
      </div>
    );
  }

  const now = new Date();
  const isPastMonth = selectedYear < now.getFullYear() || (selectedYear === now.getFullYear() && selectedMonth < now.getMonth());
  const pacePercent = forecastData.spendingPacePercent || 0;
  const isOverspending = forecastData.isOverspending;
  const remainingDays = forecastData.remainingDays;

  const renderProjectedValue = () => {
    if (forecastData.projectedMonthlySpending <= 0) {
      return <span className="value">{t('forecast.noData')}</span>;
    }

    if (editingProjected) {
      return (
        <span className="value forecast-edit-value">
          <input
            ref={editInputRef}
            type="text"
            className="forecast-edit-input"
            value={editedValue}
            onChange={(e) => setEditedValue(e.target.value)}
            onBlur={handleSaveProjected}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveProjected();
              if (e.key === 'Escape') setEditingProjected(false);
            }}
          />
        </span>
      );
    }

    return (
      <span className="value forecast-editable" onClick={() => {
        setEditedValue(Math.round(forecastData.projectedMonthlySpending).toString());
        setEditingProjected(true);
      }}>
        {formatCurrency(forecastData.projectedMonthlySpending)}
        <svg className="forecast-edit-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          <path d="m15 5 4 4" />
        </svg>
      </span>
    );
  };

  return (
    <div className="forecast-container">
      <h2>{t('forecast.title')}</h2>
      <div className="forecast-content">
        {isPastMonth ? (
          <>
            <div className="forecast-item">
              <span className="label">{t('forecast.dailyAverage')}</span>
              <span className="value">{forecastData.dailySpending > 0 ? formatCurrency(forecastData.dailySpending) + t('forecast.perDay') : t('forecast.noData')}</span>
            </div>
            <div className="forecast-item">
              <span className="label">{t('forecast.projectedSpending')}</span>
              {renderProjectedValue()}
            </div>
            {forecastData.hasBaseline ? (
              <>
                <div className={`forecast-item forecast-status ${isOverspending ? 'overspending' : 'on-track'}`}>
                  <span className="label">{t('forecast.spendingPace')}</span>
                  <span className="value">
                    {pacePercent > 0 ? pacePercent + '% — ' : ''}
                    {isOverspending ? t('forecast.overspending') : t('forecast.onTrack')}
                  </span>
                  <div className="pace-bar-track">
                    <div
                      className={`pace-bar-fill ${isOverspending ? 'overspending' : 'on-track'}`}
                      style={{ width: `${Math.min(pacePercent, 120)}%` }}
                    />
                  </div>
                </div>
                <div className="forecast-item">
                  <span className="label">{t('forecast.typicalSpending')}</span>
                  <span className="value">{formatCurrency(forecastData.typicalMonthlySpending)}</span>
                </div>
              </>
            ) : (
              <div className="forecast-item">
                <span className="label">{t('forecast.spendingPace')}</span>
                <span className="value forecast-na">{t('forecast.noBaselineData') || 'No baseline data'}</span>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="forecast-item">
              <span className="label">{t('forecast.currentBalance')}</span>
              <span className="value">{formatCurrency(currentBalance)}</span>
            </div>
            <div className="forecast-item">
              <span className="label">{t('forecast.dailyAverage')}</span>
              <span className="value">{forecastData.dailySpending > 0 ? formatCurrency(forecastData.dailySpending) + t('forecast.perDay') : t('forecast.noData')}</span>
            </div>
            <div className="forecast-item">
              <span className="label">{t('forecast.daysRemaining')}</span>
              <span className="value">{remainingDays} {t('forecast.days')}</span>
            </div>
            {forecastData.hasBaseline && forecastData.hasSufficientData ? (
              <>
                <div className="forecast-item">
                  <span className="label">{t('forecast.projectedBalance')}</span>
                  <span className="value">{formatCurrency(forecastData.projectedBalance)}</span>
                </div>
                <div className={`forecast-item forecast-status ${isOverspending ? 'overspending' : 'on-track'}`}>
                  <span className="label">{t('forecast.spendingPace')}</span>
                  <span className="value">
                    {pacePercent > 0 ? pacePercent + '% — ' : ''}
                    {isOverspending ? t('forecast.overspending') : t('forecast.onTrack')}
                  </span>
                  <div className="pace-bar-track">
                    <div
                      className={`pace-bar-fill ${isOverspending ? 'overspending' : 'on-track'}`}
                      style={{ width: `${Math.min(pacePercent, 120)}%` }}
                    />
                  </div>
                </div>
                <div className="forecast-item">
                  <span className="label">{t('forecast.typicalSpending')}</span>
                  <span className="value">{formatCurrency(forecastData.typicalMonthlySpending)}</span>
                </div>
                <div className="forecast-item">
                  <span className="label">{t('forecast.projectedSpending')}</span>
                  {renderProjectedValue()}
                </div>
              </>
            ) : (
              <div className="forecast-item">
                <span className="label">{t('forecast.spendingPace')}</span>
                <span className="value forecast-na">{t('forecast.noBaseline')}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Forecast;

// Standard provider+hook context module; the react-refresh export
// restriction is intentionally waived (hook and provider belong together).
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState } from 'react';
import { formatMoney } from '../utils/currency';

const CurrencyContext = createContext();

export const useCurrency = () => useContext(CurrencyContext);

const CURRENCY_KEY = 'basalt-currency';
const VND_MODE_KEY = 'basalt-vnd-mode';

export const CurrencyProvider = ({ children }) => {
  const [currency, setCurrencyState] = useState(() => {
    try {
      return localStorage.getItem(CURRENCY_KEY) || 'USD';
    } catch {
      return 'USD';
    }
  });

  const [vndDisplayMode, setVndDisplayModeState] = useState(() => {
    try {
      return localStorage.getItem(VND_MODE_KEY) || 'scaled';
    } catch {
      return 'scaled';
    }
  });

  const persist = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be unavailable (private mode) — the choice still applies
      // for this session.
    }
  };

  const setCurrency = (next) => {
    setCurrencyState(next);
    persist(CURRENCY_KEY, next);
  };

  const toggleCurrency = () => {
    setCurrency(currency === 'USD' ? 'VND' : 'USD');
  };

  const setVndDisplayMode = (mode) => {
    setVndDisplayModeState(mode);
    persist(VND_MODE_KEY, mode);
  };

  const formatCurrency = (amount) =>
    formatMoney(amount, currency, vndDisplayMode);

  return (
    <CurrencyContext.Provider
      value={{ currency, setCurrency, toggleCurrency, vndDisplayMode, setVndDisplayMode, formatCurrency }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

// Our currency state (code plus VND display mode), with formatting folded
// in: CurrencyProvider owns it, useCurrency reads it, both exported from
// this file — so the react-refresh rule is waived on the next line rather
// than scattering the hook into its own module.
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
      // Private mode (or a full disk) can make localStorage throw. The
      // setter already moved state, so formatting follows the new choice
      // for the rest of this session — we only lose the persistence.
    }
  };

  const setCurrency = (next) => {
    setCurrencyState(next);
    persist(CURRENCY_KEY, next);
  };

  const setVndDisplayMode = (mode) => {
    setVndDisplayModeState(mode);
    persist(VND_MODE_KEY, mode);
  };

  const formatCurrency = (amount) =>
    formatMoney(amount, currency, vndDisplayMode);

  return (
    <CurrencyContext.Provider
      value={{ currency, setCurrency, vndDisplayMode, setVndDisplayMode, formatCurrency }}
    >
      {children}
    </CurrencyContext.Provider>
  );
};

// Standard provider+hook context module; the react-refresh export
// restriction is intentionally waived (hook and provider belong together).
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback } from 'react';
import { translations } from '../i18n/translations';

const LanguageContext = createContext();

export const useLanguage = () => useContext(LanguageContext);

const LANG_STORAGE_KEY = 'basalt-lang';

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(() => {
    // Mirror the active language onto <html lang> during render (before
    // children mount) so assistive tech never hears a mismatched locale.
    let initial;
    try {
      initial = localStorage.getItem(LANG_STORAGE_KEY) || 'EN';
    } catch {
      initial = 'EN';
    }
    document.documentElement.setAttribute('lang', initial.toLowerCase());
    return initial;
  });

  const setLanguage = useCallback((next) => {
    setLanguageState(next);
    document.documentElement.setAttribute('lang', next.toLowerCase());
    try {
      localStorage.setItem(LANG_STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable (private mode) — the choice still applies
      // for this session.
    }
  }, []);

  const toggleLanguage = () => {
    setLanguage(language === 'EN' ? 'VI' : 'EN');
  };

  const t = useCallback((key, params = {}) => {
    const langKey = language === 'EN' ? 'en' : 'vi';
    // Nullish coalescing (not ||) so an intentionally empty translation
    // (e.g. form.amountHint for EN) is respected instead of being treated
    // as missing and leaking the raw key into the UI.
    let value = translations[key]?.[langKey] ?? translations[key]?.['en'] ?? key;
    Object.entries(params).forEach(([k, v]) => {
      value = value.replace(`{${k}}`, v);
    });
    return value;
  }, [language]);

  return (
    <LanguageContext.Provider value={{ language, setLanguage, toggleLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

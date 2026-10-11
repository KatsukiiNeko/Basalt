// Our EN/VI language state. One provider, one hook (useLanguage), both
// exported from this file — which is why the react-refresh rule is waived
// on the next line instead of moving the hook somewhere else: the hook and
// the provider belong together, splitting them only relocates the warning.
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback } from 'react';
import { translations } from '../i18n/translations';

const LanguageContext = createContext();

export const useLanguage = () => useContext(LanguageContext);

const LANG_STORAGE_KEY = 'basalt-lang';

export const LanguageProvider = ({ children }) => {
  const [language, setLanguageState] = useState(() => {
    // We mirror the active language onto <html lang> right here in the
    // state initializer, not in an effect: this runs during the provider's
    // own render, before children mount, so assistive tech never hears a
    // mismatched locale on first paint.
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
      // Private mode (or a full disk) can make localStorage throw. State
      // already changed above, so the language applies for this session —
      // it just won't survive a reload.
    }
  }, []);

  const toggleLanguage = () => {
    setLanguage(language === 'EN' ? 'VI' : 'EN');
  };

  const t = useCallback((key, params = {}) => {
    const langKey = language === 'EN' ? 'en' : 'vi';
    // Nullish coalescing, not ||: an empty string is a deliberately blank
    // translation, not a missing key, and ?? — unlike || — keeps them
    // apart. With || the blank would keep falling through the chain (EN
    // copy, then the key itself), so an empty hint such as form.amountHint
    // would render as raw key text in the UI.
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

// Our dark/light theme state: ThemeProvider holds it, useTheme reads it,
// and both are exported from this file — so the react-refresh rule is
// waived on the next line rather than splitting the hook into a module of
// its own.
/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ThemeContext = createContext();

const THEME_KEY = 'basalt-theme';

const getSystemTheme = () =>
  window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';

export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      if (saved === 'dark' || saved === 'light') return saved;
      return getSystemTheme();
    } catch {
      return getSystemTheme();
    }
  });

  // We write data-theme during render itself rather than in an effect:
  // the provider body runs before children render, and canvas-based
  // consumers like ECharts resolve CSS variables at that moment. An effect
  // would land one cycle too late, so they'd paint with the previous
  // palette while `theme` already reports the new one.
  document.documentElement.setAttribute('data-theme', theme);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private mode (or a full disk) can make localStorage throw. Nothing
      // to roll back: data-theme was already applied during render, so the
      // theme holds for this session — it just won't survive a reload.
    }
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      const saved = localStorage.getItem(THEME_KEY);
      if (!saved) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  }, []);

  const value = useMemo(() => ({ theme, toggleTheme, setTheme }), [theme, toggleTheme, setTheme]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);

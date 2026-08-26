import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';

const ThemeContext = createContext();

const THEME_KEY = 'money-vault-theme';

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

  // Sync the DOM attribute during render itself (provider body runs before
  // children render): canvas-based consumers like ECharts resolve CSS vars
  // while rendering, so the palette they read must match `theme` in the same
  // pass — an effect would run one cycle too late.
  document.documentElement.setAttribute('data-theme', theme);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch { }
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

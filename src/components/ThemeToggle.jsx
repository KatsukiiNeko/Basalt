import { useRef } from 'react';
import { useTheme } from '../context/ThemeContext';

const ThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const btnRef = useRef(null);

  const handleToggle = () => {
    const btn = btnRef.current;
    if (!btn) return;

    btn.classList.add('theme-toggle-animating');
    setTimeout(() => {
      setTheme(theme === 'dark' ? 'light' : 'dark');
    }, 150);
    setTimeout(() => {
      btn.classList.remove('theme-toggle-animating');
    }, 350);
  };

  return (
    <button
      ref={btnRef}
      className="theme-toggle"
      onClick={handleToggle}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      )}
      <span className="theme-toggle-label">{theme}</span>
    </button>
  );
};

export default ThemeToggle;

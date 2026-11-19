import { useEffect, useRef } from 'react';
import PasswordManager from './PasswordManager';
import BackupRestore from './BackupRestore';
import CurrencySection from './CurrencySection';
import { useLanguage } from '../context/LanguageContext';

// Settings is a full-width view inside the shell, not a floating panel.
// Escape still closes it, and focus lands on the close control on open.
const SettingsPanel = ({ isOpen, onClose, onBackup, onSecureBackup, onRestore, onSecureRestore, onExport }) => {
  const { t } = useLanguage();
  const closeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    closeRef.current?.focus();
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <section className="settings-view" aria-labelledby="settings-panel-title">
      <div className="settings-view-head">
        <div>
          <p className="eyebrow">{t('settings.eyebrow')}</p>
          <h2 id="settings-panel-title">{t('settings.title')}</h2>
        </div>
        <button
          ref={closeRef}
          className="settings-close-btn"
          onClick={onClose}
          aria-label={t('settings.close')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.currencySection')}</div>
        <CurrencySection />
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.security')}</div>
        <div className="settings-item">
          <PasswordManager />
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.data')}</div>
        <div className="settings-item">
          <BackupRestore
            onBackup={onBackup}
            onSecureBackup={onSecureBackup}
            onRestore={onRestore}
            onSecureRestore={onSecureRestore}
            onExport={onExport}
          />
        </div>
      </div>
    </section>
  );
};

export default SettingsPanel;

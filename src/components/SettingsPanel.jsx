import Modal from './Modal';
import PasswordManager from './PasswordManager';
import BackupRestore from './BackupRestore';
import CurrencySection from './CurrencySection';
import { useLanguage } from '../context/LanguageContext';

const SettingsPanel = ({ isOpen, onClose, onBackup, onSecureBackup, onRestore, onSecureRestore }) => {
  const { t } = useLanguage();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      overlayClassName="settings-overlay"
      className="settings-panel"
      labelledBy="settings-panel-title"
      focusOnOpenSelector=".settings-close-btn"
    >
      <div className="settings-panel-header">
        <h2 id="settings-panel-title">{t('settings.title')}</h2>
        <button
          className="settings-close-btn"
          onClick={onClose}
          aria-label={t('settings.close')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
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
          />
        </div>
      </div>
    </Modal>
  );
};

export default SettingsPanel;
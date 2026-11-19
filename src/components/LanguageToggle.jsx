import { useLanguage } from '../context/LanguageContext';

// Language is shown as two code labels: no flags, no second icon set.
const LanguageToggle = () => {
  const { language, toggleLanguage, t } = useLanguage();

  return (
    <button
      className="language-toggle"
      onClick={toggleLanguage}
      title={t('toggle.switchLanguage')}
      aria-label={`${t('toggle.switchLanguage')} — EN / VI`}
    >
      <span className={`lang-option ${language === 'EN' ? 'active' : ''}`}>EN</span>
      <span className="lang-divider" aria-hidden="true">/</span>
      <span className={`lang-option ${language === 'VI' ? 'active' : ''}`}>VI</span>
    </button>
  );
};

export default LanguageToggle;

import { useLanguage } from '../context/LanguageContext';

const LanguageToggle = () => {
  const { language, toggleLanguage } = useLanguage();

  return (
    <button className="currency-toggle" onClick={toggleLanguage} title={`Switch to ${language === 'EN' ? 'Vietnamese' : 'English'}`}>
      <span className={`flag-option ${language === 'EN' ? 'active' : ''}`}>
        <svg viewBox="0 0 22 16" className="flag-icon">
          <defs>
            <clipPath id="en-tl">
              <polygon points="0,0 22,0 0,16" />
            </clipPath>
            <clipPath id="en-br">
              <polygon points="22,0 22,16 0,16" />
            </clipPath>
          </defs>
          <g clipPath="url(#en-tl)">
            <rect width="22" height="16" fill="#B22234" />
            <rect y="1.23" width="22" height="1.23" fill="#fff" />
            <rect y="3.69" width="22" height="1.23" fill="#fff" />
            <rect y="6.15" width="22" height="1.23" fill="#fff" />
            <rect y="8.62" width="22" height="1.23" fill="#fff" />
            <rect y="11.08" width="22" height="1.23" fill="#fff" />
            <rect y="13.54" width="22" height="1.23" fill="#fff" />
            <rect width="8.8" height="8.62" fill="#3C3B6E" />
          </g>
          <g clipPath="url(#en-br)">
            <rect width="22" height="16" fill="#012169" />
            <line x1="0" y1="0" x2="22" y2="16" stroke="#fff" strokeWidth="2.7" />
            <line x1="22" y1="0" x2="0" y2="16" stroke="#fff" strokeWidth="2.7" />
            <line x1="0" y1="0" x2="22" y2="16" stroke="#C8102E" strokeWidth="1.3" />
            <line x1="22" y1="0" x2="0" y2="16" stroke="#C8102E" strokeWidth="1.3" />
            <line x1="11" y1="0" x2="11" y2="16" stroke="#fff" strokeWidth="3.5" />
            <line x1="0" y1="8" x2="22" y2="8" stroke="#fff" strokeWidth="2.5" />
            <line x1="11" y1="0" x2="11" y2="16" stroke="#C8102E" strokeWidth="2" />
            <line x1="0" y1="8" x2="22" y2="8" stroke="#C8102E" strokeWidth="1.4" />
          </g>
        </svg>
        <span className="currency-label">EN</span>
      </span>
      <span className="toggle-divider">/</span>
      <span className={`flag-option ${language === 'VI' ? 'active' : ''}`}>
        <svg viewBox="0 0 640 480" className="flag-icon">
          <path fill="#da251d" d="M0 0h640v480H0z" />
          <path fill="#ff0" d="m320 134 24.3 74.8H422l-64 46.5 24.4 74.7L320 284l-62.4 46 24.4-74.7-64-46.5h77.7z" />
        </svg>
        <span className="currency-label">VI</span>
      </span>
    </button>
  );
};

export default LanguageToggle;

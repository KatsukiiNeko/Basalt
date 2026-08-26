import { useCurrency } from '../context/CurrencyContext';

const CurrencyToggle = () => {
  const { currency, toggleCurrency } = useCurrency();

  return (
    <button className="currency-toggle" onClick={toggleCurrency} title={`Switch to ${currency === 'USD' ? 'VND' : 'USD'}`}>
      <span className={`flag-option ${currency === 'USD' ? 'active' : ''}`}>
        <svg viewBox="0 0 640 480" className="flag-icon">
          <path fill="#bd3d44" d="M0 0h640v37H0zm0 73h640v37H0zm0 73h640v37H0zm0 73h640v37H0zm0 73h640v37H0zm0 73h640v37H0z"/>
          <path fill="#fff" d="M0 37h640v37H0zm0 73h640v37H0zm0 73h640v37H0zm0 73h640v37H0zm0 73h640v37H0zm0 73h640v37H0z"/>
          <path fill="#192f5d" d="M0 0h260v260H0z"/>
        </svg>
        <span className="currency-label">USD</span>
      </span>
      <span className="toggle-divider">/</span>
      <span className={`flag-option ${currency === 'VND' ? 'active' : ''}`}>
        <svg viewBox="0 0 640 480" className="flag-icon">
          <path fill="#da251d" d="M0 0h640v480H0z"/>
          <path fill="#ff0" d="m320 134 24.3 74.8H422l-64 46.5 24.4 74.7L320 284l-62.4 46 24.4-74.7-64-46.5h77.7z"/>
        </svg>
        <span className="currency-label">VND</span>
      </span>
    </button>
  );
};

export default CurrencyToggle;

import { useCurrency } from '../context/CurrencyContext';
import { useLanguage } from '../context/LanguageContext';
import { formatMoney } from '../utils/currency';

// The example uses a canonical amount large enough to expose the display
// difference between modes; it is NOT a stored value.
const EXAMPLE_STORED = 1250000;

// Currency + VND display-format settings with a live-updating example.
// Replaces the bare USD/VND flag toggle: the display-format distinction
// (Full VND vs Thousand VND) is the setting users actually need to see,
// and the live example makes the choice self-explanatory (brief §7).
// Stored values are never touched — only presentation changes (DR-0003).
const CurrencySection = () => {
  const { currency, setCurrency, vndDisplayMode, setVndDisplayMode } = useCurrency();
  const { t } = useLanguage();

  const isVnd = currency === 'VND';
  const example = formatMoney(EXAMPLE_STORED, currency, vndDisplayMode);

  const optionClass = (selected) =>
    `currency-option ${selected ? 'selected' : ''}`;

  return (
    <div className="currency-section">
      <p className="currency-section-help">{t('settings.currencyHelp')}</p>

      <div className="currency-options" role="radiogroup" aria-label={t('settings.currencySection')}>
        <button
          type="button"
          role="radio"
          aria-checked={isVnd}
          className={optionClass(isVnd)}
          onClick={() => setCurrency('VND')}
        >
          <span className="currency-option-title">VND</span>
          <span className="currency-option-desc">
            {isVnd ? t('settings.vndFullDesc') : t('onboarding.currency.vnd')}
          </span>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!isVnd}
          className={optionClass(!isVnd)}
          onClick={() => setCurrency('USD')}
        >
          <span className="currency-option-title">USD</span>
          <span className="currency-option-desc">{t('settings.usdDesc')}</span>
        </button>
      </div>

      {isVnd && (
        <div className="currency-format-row">
          <span className="currency-format-label">{t('settings.displayFormat')}</span>
          <div className="currency-format-options" role="radiogroup" aria-label={t('settings.displayFormat')}>
            <button
              type="button"
              role="radio"
              aria-checked={vndDisplayMode === 'exact'}
              className={optionClass(vndDisplayMode === 'exact')}
              onClick={() => setVndDisplayMode('exact')}
            >
              <span className="currency-option-title">{t('settings.vndFull')}</span>
              <span className="currency-option-desc">{t('settings.vndFullDesc')}</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={vndDisplayMode === 'scaled'}
              className={optionClass(vndDisplayMode === 'scaled')}
              onClick={() => setVndDisplayMode('scaled')}
            >
              <span className="currency-option-title">{t('settings.vndThousands')}</span>
              <span className="currency-option-desc">{t('settings.vndThousandsDesc')}</span>
            </button>
          </div>
        </div>
      )}

      <div className="currency-live-example" aria-live="polite">
        <span className="currency-example-label">{t('settings.liveExampleLabel')}</span>
        <span className="currency-example-value">{example}</span>
      </div>
    </div>
  );
};

export default CurrencySection;

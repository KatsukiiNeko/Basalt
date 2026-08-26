import { useState } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { useCurrency } from '../context/CurrencyContext';
import { formatMoney } from '../utils/currency';

const ONBOARDING_KEY = 'money-vault-onboarded';

// Wizard: 0 welcome -> 1 language -> 2 currency -> 3 VND display mode.
// Step 3 only appears when VND is chosen — the display-unit distinction
// only exists for VND. Stored values are never touched either way (DR-0003).
const VND_STEP = 3;

const EXAMPLE_AMOUNT = 1250000;

const LANGUAGES = [
  { code: 'EN', labelKey: 'onboarding.lang.en', flag: '🇬🇧' },
  { code: 'VI', labelKey: 'onboarding.lang.vi', flag: '🇻🇳' }
];

const CURRENCIES = [
  { code: 'USD', labelKey: 'onboarding.currency.usd' },
  { code: 'VND', labelKey: 'onboarding.currency.vnd' }
];

const VND_MODES = [
  {
    mode: 'scaled',
    titleKey: 'onboarding.vndMode.scaledTitle',
    descKey: 'onboarding.vndMode.scaledDesc'
  },
  {
    mode: 'exact',
    titleKey: 'onboarding.vndMode.exactTitle',
    descKey: 'onboarding.vndMode.exactDesc'
  }
];

const WelcomeIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

const GlobeIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const CoinIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M14.5 9a2.5 2.5 0 0 0-2.5-1.5A2.5 2.5 0 0 0 9.5 10c0 3 5 1.5 5 4a2.5 2.5 0 0 1-2.5 2.5A2.5 2.5 0 0 1 9.5 15" />
    <line x1="12" y1="6" x2="12" y2="7.5" />
    <line x1="12" y1="16.5" x2="12" y2="18" />
  </svg>
);

const ScaleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  </svg>
);

const OptionButton = ({ selected, onClick, children }) => (
  <button
    type="button"
    className={`onboarding-option ${selected ? 'selected' : ''}`}
    onClick={onClick}
    aria-pressed={selected}
  >
    {children}
  </button>
);

const OnboardingOverlay = ({ onComplete }) => {
  const [step, setStep] = useState(0);
  const { t, language, setLanguage } = useLanguage();
  const { currency, setCurrency, vndDisplayMode, setVndDisplayMode } = useCurrency();

  const complete = () => {
    try {
      localStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // Storage unavailable — still complete for this session.
    }
    onComplete();
  };

  const handleNext = () => {
    if (step < lastStep) {
      setStep(step + 1);
    } else {
      complete();
    }
  };

  const liveExample = formatMoney(EXAMPLE_AMOUNT, currency, vndDisplayMode);

  // USD skips the display-format step entirely — the VND-vs-Thousand-VND
  // distinction only exists for VND.
  const lastStep = currency === 'VND' ? VND_STEP : VND_STEP - 1;

  return (
    <div className="onboarding-overlay">
      <div className="onboarding-card">
        {step === 0 && (
          <>
            <div className="onboarding-icon step1">
              <WelcomeIcon />
            </div>
            <h3>{t('onboarding.welcome')}</h3>
            <p>{t('onboarding.wizardIntro')}</p>
          </>
        )}

        {step === 1 && (
          <>
            <div className="onboarding-icon step2">
              <GlobeIcon />
            </div>
            <h3>{t('onboarding.languageTitle')}</h3>
            <p>{t('onboarding.languageDesc')}</p>
            <div className="onboarding-options">
              {LANGUAGES.map(({ code, labelKey, flag }) => (
                <OptionButton
                  key={code}
                  selected={language === code}
                  onClick={() => setLanguage(code)}
                >
                  <span className="onboarding-option-flag">{flag}</span>
                  <span className="onboarding-option-label">{t(labelKey)}</span>
                  {language === code && <span className="onboarding-option-check">✓</span>}
                </OptionButton>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div className="onboarding-icon step3">
              <CoinIcon />
            </div>
            <h3>{t('onboarding.currencyTitle')}</h3>
            <p>{t('onboarding.currencyDesc')}</p>
            <div className="onboarding-options">
              {CURRENCIES.map(({ code, labelKey }) => (
                <OptionButton
                  key={code}
                  selected={currency === code}
                  onClick={() => setCurrency(code)}
                >
                  <span className="onboarding-option-label">{t(labelKey)}</span>
                  {currency === code && <span className="onboarding-option-check">✓</span>}
                </OptionButton>
              ))}
            </div>
          </>
        )}

        {step === VND_STEP && currency === 'VND' && (
          <>
            <div className="onboarding-icon step2">
              <ScaleIcon />
            </div>
            <h3>{t('onboarding.vndMode.title')}</h3>
            <p>{t('onboarding.vndMode.intro')}</p>
            <div className="onboarding-options">
              {VND_MODES.map(({ mode, titleKey, descKey }) => (
                <OptionButton
                  key={mode}
                  selected={vndDisplayMode === mode}
                  onClick={() => setVndDisplayMode(mode)}
                >
                  <span className="onboarding-option-label">{t(titleKey)}</span>
                  <span className="onboarding-option-desc">{t(descKey)}</span>
                </OptionButton>
              ))}
            </div>
            <div className="onboarding-example">
              <span className="onboarding-example-label">{t('onboarding.vndMode.liveExample')}</span>
              <span className="onboarding-example-value">{liveExample}</span>
            </div>
          </>
        )}

        <div className="onboarding-dots">
          {Array.from({ length: lastStep + 1 }, (_, i) => (
            <div key={i} className={`onboarding-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>

        <div className="onboarding-actions">
          <button className="onboarding-skip" onClick={complete}>
            {t('onboarding.skip')}
          </button>
          <button className="onboarding-next" onClick={handleNext}>
            {step < lastStep ? t('onboarding.next') : t('onboarding.done')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default OnboardingOverlay;

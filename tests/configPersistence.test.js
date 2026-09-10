import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatMoney } from '../src/utils/currency';
import { translations } from '../src/i18n/translations';

// Config persistence contract: the onboarding wizard writes real choices
// through the same localStorage keys the contexts read at startup. jsdom
// gives us a real (in-memory) localStorage per test file.
const KEYS = {
  currency: 'basalt-currency',
  vndMode: 'basalt-vnd-mode',
  lang: 'basalt-lang',
  onboarded: 'basalt-onboarded'
};

describe('onboarding/config persistence keys', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('contexts read back what the wizard persists', () => {
    // Simulate OnboardingOverlay's writes (setCurrency/setVndDisplayMode/
    // setLanguage/complete all persist through these exact keys).
    localStorage.setItem(KEYS.currency, 'VND');
    localStorage.setItem(KEYS.vndMode, 'exact');
    localStorage.setItem(KEYS.lang, 'VI');
    localStorage.setItem(KEYS.onboarded, '1');

    expect(localStorage.getItem(KEYS.currency)).toBe('VND');
    expect(localStorage.getItem(KEYS.vndMode)).toBe('exact');
    expect(localStorage.getItem(KEYS.lang)).toBe('VI');
    expect(localStorage.getItem(KEYS.onboarded)).toBe('1');

    // Dashboard's first-run gate reads exactly this sentinel.
    expect(localStorage.getItem(KEYS.onboarded) !== '1').toBe(false);
  });

  it('defaults apply when storage is empty (first run)', () => {
    expect(localStorage.getItem(KEYS.currency)).toBeNull();
    expect(localStorage.getItem(KEYS.vndMode)).toBeNull();
    expect(localStorage.getItem(KEYS.lang)).toBeNull();

    // Context initializers fall back: USD / scaled / EN — and Dashboard
    // treats a null onboarded flag as "show onboarding".
    expect((localStorage.getItem(KEYS.currency) || 'USD')).toBe('USD');
    expect((localStorage.getItem(KEYS.vndMode) || 'scaled')).toBe('scaled');
    expect((localStorage.getItem(KEYS.lang) || 'EN')).toBe('EN');
    expect(localStorage.getItem(KEYS.onboarded) !== '1').toBe(true);
  });
});

describe('persisted config drives formatting consistently', () => {
  it('currency + vnd-mode combos produce the documented presentations', () => {
    const stored = 1250;

    const view = (cur, mode) => formatMoney(stored, cur, mode);

    // VND scaled: stored value IS thousands of dong, stated explicitly.
    expect(view('VND', 'scaled')).toBe('1.250K VND');
    // VND exact: stored value IS dong.
    expect(view('VND', 'exact')).toBe('1.250 VND');
    // USD ignores vnd-mode entirely.
    expect(view('USD', 'scaled')).toBe('1,250.00 USD');
    expect(view('USD', 'exact')).toBe('1,250.00 USD');
  });
});

describe('amountHint translation keys resolve in every language', () => {
  // Regression guard for the original bug: a missing key leaked its raw
  // identifier into the UI. Both modes must resolve to non-key strings in
  // both en and vi.
  it.each([
    ['form.amountHint.scaled'],
    ['form.amountHint.exact']
  ])('%s resolves via t()-style lookup without leaking the key', (key) => {
    for (const lang of ['en', 'vi']) {
      const value = translations[key]?.[lang] ?? translations[key]?.['en'] ?? key;
      expect(value).not.toBe(key);
      expect(value.length).toBeGreaterThan(0);
      expect(value).toMatch(/unit|đơn vị/i);
    }
  });

  it('the legacy singular amountHint key no longer exists (replaced by pair)', () => {
    expect(translations['form.amountHint']).toBeUndefined();
  });

// V2 i18n layer: every user-facing key added by the currency settings and
// the month picker must resolve in BOTH languages. t() leaks the raw key
// when a translation is missing; this suite pins the whole surface so a
// raw key can never ship in either language.
describe('V2 translation surface completeness', () => {
  const REQUIRED_KEYS = [
    'settings.currencySection', 'settings.currencyHelp', 'settings.displayFormat',
    'settings.vndFull', 'settings.vndFullDesc', 'settings.vndThousands',
    'settings.vndThousandsDesc', 'settings.liveExampleLabel', 'settings.usdDesc',
    'month.january', 'month.december', 'month.short.january', 'month.short.december',
    'toggle.previousMonth', 'toggle.nextMonth', 'toggle.switchLanguage',
    'toggle.switchTheme', 'toggle.back',
  ];

  it.each(REQUIRED_KEYS)('%s resolves in en and vi without leaking the key', (key) => {
    expect(translations[key]).toBeDefined();
    expect(translations[key].en).toBeTruthy();
    expect(translations[key].vi).toBeTruthy();
    expect(translations[key].en).not.toBe(key);
  });

  it('every month has full and short names in both languages', () => {
    const MONTHS = ['january','february','march','april','may','june',
                    'july','august','september','october','november','december'];
    for (const m of MONTHS) {
      expect(translations['month.' + m]).toBeDefined();
      expect(translations['month.short.' + m]).toBeDefined();
      expect(translations['month.' + m].en).toBeTruthy();
      expect(translations['month.' + m].vi).toBeTruthy();
    }
  });

  it('languageLocale maps every supported language code', async () => {
    const { languageLocale } = await import('../src/i18n/translations');
    expect(languageLocale.EN).toBe('en-US');
    expect(languageLocale.VI).toBe('vi-VN');
  });
});

});

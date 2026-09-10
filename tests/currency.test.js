import { describe, it, expect } from 'vitest';
import { formatMoney, groupDigits, GROUP_SEPARATOR } from '../src/utils/currency';

describe('groupDigits', () => {
  it.each([
    ['1000100', 'VND', '1.000.100'],
    ['1250000', 'VND', '1.250.000'],
    ['999', 'VND', '999'],
    ['1000', 'VND', '1.000'],
    ['1000100', 'USD', '1,000,100'],
    ['0', 'VND', '0'],
    ['', 'VND', '']
  ])('%s (%s) -> %s', (input, currency, expected) => {
    expect(groupDigits(input, currency)).toBe(expected);
  });

  it('falls back to dot grouping for unknown currencies', () => {
    expect(groupDigits('1234', 'EUR')).toBe('1.234');
  });
});

describe('formatMoney — USD', () => {
  it('groups the integer part and always renders 2 decimals', () => {
    expect(formatMoney(1234.5, 'USD')).toBe('1,234.50 USD');
    expect(formatMoney(1234567.89, 'USD')).toBe('1,234,567.89 USD');
    expect(formatMoney(42, 'USD')).toBe('42.00 USD');
  });

  it('keeps negatives sign-first', () => {
    expect(formatMoney(-987.25, 'USD')).toBe('-987.25 USD');
  });
});

describe('formatMoney — VND scaled mode (legacy thousand-unit storage)', () => {
  it('renders the stored thousands with an explicit K marker', () => {
    // Stored "50" (thousand-VND) displays as 50K VND. The K marker is
    // load-bearing: without it, "50.000 VND" reads as plain đồng and
    // recreates the unit confusion the display-mode choice exists to fix.
    expect(formatMoney(50, 'VND', 'scaled')).toBe('50K VND');
    expect(formatMoney(1250, 'VND', 'scaled')).toBe('1.250K VND');
  });
});

describe('formatMoney — VND exact mode', () => {
  it('renders stored values verbatim with dot grouping', () => {
    expect(formatMoney(1250000, 'VND', 'exact')).toBe('1.250.000 VND');
    expect(formatMoney(1000100, 'VND', 'exact')).toBe('1.000.100 VND');
    expect(formatMoney(999, 'VND', 'exact')).toBe('999 VND');
  });
});

describe('formatMoney — DR-0003 invariant (display-only scaling)', () => {
  it('never mutates its input and produces different views of one stored value', () => {
    const stored = 1250;
    const snapshot = stored;

    formatMoney(stored, 'VND', 'scaled');

    expect(stored).toBe(snapshot); // untouched
    // One stored number, two legitimate presentations — never two storages.
    // Scaled states its unit ("thousands") explicitly; exact shows full đồng.
    expect(formatMoney(stored, 'VND', 'scaled')).toBe('1.250K VND');
    expect(formatMoney(stored, 'VND', 'exact')).toBe('1.250 VND');
  });
});

describe('formatMoney — defensive defaults', () => {
  it.each([
    [NaN],
    [Infinity],
    [-Infinity],
    [undefined],
    [null],
    ['1250000'], // string amounts are a programming error, rendered as zero
    [{}]
  ])('renders %p as the zero amount instead of throwing', (input) => {
    expect(formatMoney(input, 'USD')).toBe('0.00 USD');
    expect(formatMoney(input, 'VND', 'exact')).toBe('0 VND');
  });
});

describe('GROUP_SEPARATOR', () => {
  it('matches each currency’s locale convention', () => {
    expect(GROUP_SEPARATOR.VND).toBe('.');
    expect(GROUP_SEPARATOR.USD).toBe(',');
  });
});

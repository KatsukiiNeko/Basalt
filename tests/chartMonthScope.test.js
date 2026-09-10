// Month-scoping utilities that keep charts in sync with the MonthPicker
// selection. Regression guard for the V2 bug where doughnut/top-categories
// aggregated the ENTIRE vault, never matching the selected month.
import { describe, it, expect } from 'vitest';
import {
  isTransactionInMonth,
  transactionsInMonth,
  trendMonthKeys,
  TREND_WINDOW,
  aggregateExpensesByCategory,
} from '../src/utils/chartData';

const tx = (date, category, amount) => ({ date, type: 'expense', category, amount });

const TXS = [
  tx('2026-01-05', 'Food & Dining', 100),
  tx('2026-02-03', 'Food & Dining', 200),
  tx('2026-02-20', 'Transportation', 50),
  tx('2026-03-15', 'Shopping', 300),
];

describe('isTransactionInMonth / transactionsInMonth', () => {
  it('isTransactionInMonth matches only the exact year+month', () => {
    expect(isTransactionInMonth(TXS[0], 2026, 0)).toBe(true);
    expect(isTransactionInMonth(TXS[0], 2026, 1)).toBe(false);
    expect(isTransactionInMonth(TXS[0], 2025, 0)).toBe(false);
  });

  it('keeps only the selected calendar month (month is 0-based)', () => {
    const feb = transactionsInMonth(TXS, 2026, 1); // February
    expect(feb).toHaveLength(2);
    expect(feb.every((t) => t.date.startsWith('2026-02'))).toBe(true);
  });

  it('handles year boundaries', () => {
    const dec2025 = transactionsInMonth(
      [...TXS, tx('2025-12-31', 'Food & Dining', 10)],
      2025, 11
    );
    expect(dec2025).toHaveLength(1);
    expect(dec2025[0].date).toBe('2025-12-31');
  });

  it('returns empty for a month with no transactions', () => {
    expect(transactionsInMonth(TXS, 2026, 5)).toEqual([]);
  });

  it('drives category aggregation scoped to the month', () => {
    const march = transactionsInMonth(TXS, 2026, 2);
    const { categories, totalExpenses } = aggregateExpensesByCategory(march);
    expect(totalExpenses).toBe(300);
    expect(categories).toHaveLength(1);
    expect(categories[0].name).toBe('Shopping');
  });
});

describe('trendMonthKeys', () => {
  it('returns window keys oldest-first, ending at the selected month', () => {
    const keys = trendMonthKeys(2026, 2); // March 2026
    expect(keys).toHaveLength(TREND_WINDOW);
    expect(keys[0]).toBe('2025-10');
    expect(keys[keys.length - 1]).toBe('2026-03');
    expect(keys).toEqual([...keys].sort()); // oldest first
  });

  it('rolls over January correctly', () => {
    const keys = trendMonthKeys(2026, 0); // January 2026
    expect(keys[0]).toBe('2025-08');
    expect(keys[keys.length - 1]).toBe('2026-01');
  });
});

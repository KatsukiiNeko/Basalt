/**
 * Chart data aggregation utilities.
 * All functions are O(n) and return plain objects suitable for ECharts.
 * No hardcoded values — everything derives from transaction data.
 */

/**
 * Month filtering for chart inputs. Charts must reflect the month selected
 * in the MonthPicker — the pre-V2 charts aggregated the ENTIRE vault, so
 * the doughnut/top-categories totals never matched the History list or
 * the balance for the selected month.
 */

/** Number of months shown in the trend line, centered on the selection. */
export const TREND_WINDOW = 6;

/** True when a transaction's date ("YYYY-MM-DD") falls in the given month. */
export function isTransactionInMonth(tx, year, month) {
  const [txYear, txMonth] = tx.date.split('-').map(Number);
  return txYear === year && txMonth - 1 === month;
}

/**
 * Transactions filtered to one calendar month.
 *
 * @param {Array} transactions
 * @param {number} year
 * @param {number} month  0-based (Date constructor convention)
 */
export function transactionsInMonth(transactions, year, month) {
  return transactions.filter((tx) => isTransactionInMonth(tx, year, month));
}

/**
 * "YYYY-MM" keys for the [window] months ending at (year, month) inclusive —
 * oldest first. Used for a trend that follows the selected month instead of
 * spanning all recorded history.
 */
export function trendMonthKeys(year, month, window = TREND_WINDOW) {
  const keys = [];
  for (let i = window - 1; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/** Max slices before merging the smallest into "Other" */
const MAX_SLICES = 7;

/** Threshold below which a category is merged into "Other" (as fraction of total) */
const SMALL_THRESHOLD = 0.03;

/**
 * Aggregate expense transactions by category.
 * Merges small categories (< SMALL_THRESHOLD or beyond MAX_SLICES) into "Other".
 *
 * @param {Array<{amount: number, type: string, category: string}>} transactions
 * @returns {{ categories: Array<{name: string, total: number, percent: number}>, totalExpenses: number }}
 */
export function aggregateExpensesByCategory(transactions) {
  const categoryTotals = {};

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    if (tx.type !== 'expense') continue;
    const cat = tx.category || 'Other';
    categoryTotals[cat] = (categoryTotals[cat] || 0) + tx.amount;
  }

  const entries = Object.entries(categoryTotals);
  if (entries.length === 0) {
    return { categories: [], totalExpenses: 0 };
  }

  const totalExpenses = entries.reduce((sum, [, v]) => sum + v, 0);

  // Sort descending by total
  entries.sort((a, b) => b[1] - a[1]);

  const categories = [];
  let otherTotal = 0;

  for (let i = 0; i < entries.length; i++) {
    const [name, total] = entries[i];
    const percent = total / totalExpenses;

    if (i < MAX_SLICES && percent >= SMALL_THRESHOLD) {
      categories.push({ name, total, percent });
    } else {
      otherTotal += total;
    }
  }

  if (otherTotal > 0) {
    categories.push({ name: 'Other', total: otherTotal, percent: otherTotal / totalExpenses });
  }

  return { categories, totalExpenses };
}

/**
 * Return top N spending categories sorted by total descending.
 *
 * @param {Array<{amount: number, type: string, category: string}>} transactions
 * @param {number} [n=7] - number of top categories to return
 * @returns {{ categories: Array<{name: string, total: number, percent: number}>, totalExpenses: number }}
 */
export function getTopCategories(transactions, n = 7) {
  const { categories: allCat, totalExpenses } = aggregateExpensesByCategory(transactions);

  // aggregateExpensesByCategory already sorts and merges smalls.
  // Just take the top N (excluding "Other" if it was merged in).
  const mainCat = allCat.filter(c => c.name !== 'Other');
  const top = mainCat.slice(0, n);

  // If there are remaining (either the Other bucket or categories beyond N),
  // add them as "Other"
  const topNames = new Set(top.map(c => c.name));
  const remainingTotal = allCat.reduce((sum, c) => {
    if (!topNames.has(c.name)) return sum + c.total;
    return sum;
  }, 0);

  if (remainingTotal > 0) {
    top.push({ name: 'Other', total: remainingTotal, percent: remainingTotal / totalExpenses });
  }

  return { categories: top, totalExpenses };
}

/**
 * Aggregate income, expenses, and net by month.
 *
 * @param {Array<{amount: number, type: string, date: string}>} transactions
 * @returns {{ months: string[], income: number[], expense: number[], net: number[] }}
 */
export function aggregateMonthlyTrend(transactions) {
  const monthlyData = {};

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const monthKey = tx.date.slice(0, 7); // "YYYY-MM"
    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = { income: 0, expense: 0 };
    }
    if (tx.type === 'income') {
      monthlyData[monthKey].income += tx.amount;
    } else {
      monthlyData[monthKey].expense += tx.amount;
    }
  }

  const sorted = Object.keys(monthlyData).sort();
  const months = sorted;
  const income = sorted.map(k => monthlyData[k].income);
  const expense = sorted.map(k => monthlyData[k].expense);
  const net = sorted.map((k, i) => income[i] - expense[i]);

  return { months, income, expense, net };
}
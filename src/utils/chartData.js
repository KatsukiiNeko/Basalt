/**
 * Chart data aggregation utilities — ChartsSection.jsx is our main consumer
 * (exportWorkbook.js pulls aggregateMonthlyTrend for its all-time sums), so
 * a change here moves every chart at once.
 * All functions are O(n) and return plain objects suitable for ECharts.
 * No hardcoded values — everything derives from transaction data.
 */

/**
 * Month filtering for chart inputs — why this file is scoped the way it is.
 * Charts must reflect the month selected in the MonthPicker: the pre-V2
 * charts aggregated the ENTIRE vault, so the doughnut/top-categories totals
 * never matched the History list or the balance for the selected month.
 */

/** Number of months in the trend line — the window ends at the selection. */
export const TREND_WINDOW = 6;

/** True when a tx's date ("YYYY-MM-DD") falls in the given month. */
export function isTransactionInMonth(tx, year, month) {
  const [txYear, txMonth] = tx.date.split('-').map(Number);
  return txYear === year && txMonth - 1 === month;
}

/**
 * Everything inside one calendar month — the scope ChartsSection feeds the
 * doughnut and top-categories so they match History and the month balance.
 *
 * @param {Array} transactions
 * @param {number} year
 * @param {number} month  0-based (Date constructor convention)
 */
export function transactionsInMonth(transactions, year, month) {
  return transactions.filter((tx) => isTransactionInMonth(tx, year, month));
}

/**
 * The "YYYY-MM" keys for the [window] months ending at (year, month)
 * inclusive — oldest first. This is how the trend follows the selected
 * month instead of spanning all recorded history: ChartsSection aggregates
 * the whole vault once, then keeps only these keys.
 */
export function trendMonthKeys(year, month, window = TREND_WINDOW) {
  const keys = [];
  for (let i = window - 1; i >= 0; i--) {
    const d = new Date(year, month - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys;
}

/** Max slices we draw before folding the smallest into "Other" */
const MAX_SLICES = 7;

/** Share of the total below which a category folds into "Other" */
const SMALL_THRESHOLD = 0.03;

/**
 * Aggregate expense transactions by category — the doughnut's data source.
 * Merges small categories (< SMALL_THRESHOLD or beyond MAX_SLICES) into
 * "Other".
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

  // Sort descending so the entries that survive MAX_SLICES / SMALL_THRESHOLD
  // below are the biggest ones.
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
 * Return top N spending categories sorted by total descending — the ranked
 * list behind ChartsSection's top-categories view.
 *
 * @param {Array<{amount: number, type: string, category: string}>} transactions
 * @param {number} [n=7] - number of top categories to return
 * @returns {{ categories: Array<{name: string, total: number, percent: number}>, totalExpenses: number }}
 */
export function getTopCategories(transactions, n = 7) {
  const { categories: allCat, totalExpenses } = aggregateExpensesByCategory(transactions);

  // aggregateExpensesByCategory already sorted for us and merged the smalls
  // away; we just take the top N, minus the "Other" bucket if it merged in.
  const mainCat = allCat.filter(c => c.name !== 'Other');
  const top = mainCat.slice(0, n);

  // Whatever is left — the Other bucket plus every category past N — goes
  // back into one "Other" row so the slice totals still add up.
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
 * Aggregate income, expenses, and net by month. ChartsSection windows this
 * to the selected month for the trend line; exportWorkbook.js sums it for
 * the all-time income/expense figures.
 *
 * @param {Array<{amount: number, type: string, date: string}>} transactions
 * @returns {{ months: string[], income: number[], expense: number[], net: number[] }}
 */
export function aggregateMonthlyTrend(transactions) {
  const monthlyData = {};

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i];
    const monthKey = tx.date.slice(0, 7); // our month key: "YYYY-MM"
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
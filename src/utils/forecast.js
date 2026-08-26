const FIXED_CATEGORIES = ['Bills & Utilities'];
const VARIABLE_CATEGORIES = [
  'Food & Dining', 'Transportation', 'Shopping', 'Entertainment',
  'Healthcare', 'Travel', 'Education', 'Gifts & Donations'
];

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function removeOutliersIQR(values) {
  if (values.length < 8) return values;
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lower = q1 - 1.5 * iqr;
  const upper = q3 + 1.5 * iqr;
  return values.filter(v => v >= lower && v <= upper);
}

function getExpectedFixedBill(category, allTransactions, currentMonthStart) {
  const historical = allTransactions
    .filter(t =>
      t.category === category &&
      t.type === 'expense' &&
      parseDate(t.date) < currentMonthStart
    )
    .map(t => t.amount);

  return historical.length > 0 ? median(historical) : 0;
}

function computeWeekdayMultipliers(transactions, currentDate) {
  const eightWeeksAgo = new Date(currentDate);
  eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 55);

  const recentExpenses = transactions.filter(t =>
    t.type === 'expense' &&
    VARIABLE_CATEGORIES.includes(t.category) &&
    parseDate(t.date) >= eightWeeksAgo &&
    parseDate(t.date) <= currentDate
  );

  if (recentExpenses.length < 14) return null;

  const weekdaySums = new Array(7).fill(0);
  const weekdayCounts = new Array(7).fill(0);

  for (let d = new Date(eightWeeksAgo); d <= currentDate; d.setDate(d.getDate() + 1)) {
    weekdayCounts[d.getDay()]++;
  }

  recentExpenses.forEach(t => {
    const dow = parseDate(t.date).getDay();
    weekdaySums[dow] += t.amount;
  });

  const weekdayAvg = weekdaySums.map((sum, i) =>
    weekdayCounts[i] > 0 ? sum / weekdayCounts[i] : 0
  );

  const nonZeroWeekdays = weekdayAvg.filter(v => v > 0);
  if (nonZeroWeekdays.length === 0) return null;
  const overallAvg = mean(weekdayAvg);

  return weekdayAvg.map(avg => avg / overallAvg);
}

export function calculateForecast(transactions, currentBalance, currentDate = new Date(), correctionFactor = null) {
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const now = new Date();
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const currentDay = isCurrentMonth ? now.getDate() : new Date(year, month + 1, 0).getDate();
  const totalDays = new Date(year, month + 1, 0).getDate();
  const remainingDays = isCurrentMonth ? totalDays - currentDay : 0;

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 1);

  const currentMonthTxns = transactions.filter(t => {
    const d = parseDate(t.date);
    return d >= monthStart && d < monthEnd;
  });

  const variableTxns = currentMonthTxns.filter(t =>
    t.type === 'expense' && VARIABLE_CATEGORIES.includes(t.category)
  );

  const dailyTotals = new Array(totalDays + 1).fill(0);
  variableTxns.forEach(t => {
    const day = parseDate(t.date).getDate();
    if (day >= 1 && day <= totalDays) {
      dailyTotals[day] += t.amount;
    }
  });

  const allDailyTotals = dailyTotals.slice(1, currentDay + 1);
  const nonZeroTotals = allDailyTotals.filter(v => v > 0);

  const cleanedNonZero = removeOutliersIQR(nonZeroTotals);

  let dailySpending;
  if (isCurrentMonth) {
    if (cleanedNonZero.length < 3) {
      dailySpending = cleanedNonZero.length > 0 ? mean(cleanedNonZero) : 0;
    } else {
      const alpha = 0.3;
      let ewma = allDailyTotals[0];
      for (let i = 1; i < allDailyTotals.length; i++) {
        ewma = alpha * allDailyTotals[i] + (1 - alpha) * ewma;
      }
      dailySpending = ewma;
    }
  } else {
    dailySpending = cleanedNonZero.length > 0 ? mean(cleanedNonZero) : 0;
  }

  if (correctionFactor && correctionFactor.ratio && correctionFactor.month === month && correctionFactor.year === year) {
    dailySpending = dailySpending * correctionFactor.ratio;
  }

  const weekdayMultipliers = computeWeekdayMultipliers(transactions, currentDate);

  let remainingVariableSpending;
  if (weekdayMultipliers && remainingDays > 0) {
    let total = 0;
    const tempDate = new Date(currentDate);
    for (let i = 1; i <= remainingDays; i++) {
      tempDate.setDate(tempDate.getDate() + 1);
      const dow = tempDate.getDay();
      total += dailySpending * weekdayMultipliers[dow];
    }
    remainingVariableSpending = total;
  } else {
    remainingVariableSpending = dailySpending * remainingDays;
  }

  const fixedBillsPending = [];
  let projectedFixedOutflow = 0;
  for (const category of FIXED_CATEGORIES) {
    const alreadyPaid = currentMonthTxns.some(t =>
      t.category === category &&
      t.type === 'expense' &&
      parseDate(t.date).getDate() <= currentDay
    );
    if (!alreadyPaid) {
      const expected = getExpectedFixedBill(category, transactions, monthStart);
      if (expected > 0) {
        fixedBillsPending.push({ category, amount: expected });
        projectedFixedOutflow += expected;
      }
    }
  }

  const currentMonthIncome = currentMonthTxns
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + t.amount, 0);

  const monthlyIncomeTotals = [];
  const monthlyIncomeDays = [];
  for (let m = 1; m <= 3; m++) {
    const targetMonth = month - m;
    const targetYear = targetMonth < 0 ? year - 1 : year;
    const adjMonth = ((targetMonth % 12) + 12) % 12;
    const mStart = new Date(targetYear, adjMonth, 1);
    const mEnd = new Date(targetYear, adjMonth + 1, 1);
    const mDays = new Date(targetYear, adjMonth + 1, 0).getDate();

    const mIncome = transactions
      .filter(t =>
        t.type === 'income' &&
        parseDate(t.date) >= mStart &&
        parseDate(t.date) < mEnd
      )
      .reduce((sum, t) => sum + t.amount, 0);

    if (mIncome > 0) {
      monthlyIncomeTotals.push(mIncome);
      monthlyIncomeDays.push(mDays);
    }
  }

  const historicalDailyIncome = monthlyIncomeDays.length > 0
    ? monthlyIncomeTotals.reduce((s, v, i) => s + v / monthlyIncomeDays[i], 0) / monthlyIncomeDays.length
    : 0;

  const projectedIncome = currentMonthIncome + (historicalDailyIncome * remainingDays);

  const monthlyVariableTotals = [];
  for (let m = 1; m <= 3; m++) {
    const targetMonth = month - m;
    const targetYear = targetMonth < 0 ? year - 1 : year;
    const adjMonth = ((targetMonth % 12) + 12) % 12;
    const mStart = new Date(targetYear, adjMonth, 1);
    const mEnd = new Date(targetYear, adjMonth + 1, 1);

    const mTotal = transactions
      .filter(t =>
        t.type === 'expense' &&
        VARIABLE_CATEGORIES.includes(t.category) &&
        parseDate(t.date) >= mStart &&
        parseDate(t.date) < mEnd
      )
      .reduce((sum, t) => sum + t.amount, 0);

    monthlyVariableTotals.push(mTotal);
  }

  const typicalMonthlySpending = mean(monthlyVariableTotals.filter(v => v > 0));

  let baselineDaysLogged = 0;
  for (let m = 1; m <= 3; m++) {
    const targetMonth = month - m;
    const targetYear = targetMonth < 0 ? year - 1 : year;
    const adjMonth = ((targetMonth % 12) + 12) % 12;
    const mStart = new Date(targetYear, adjMonth, 1);
    const mEnd = new Date(targetYear, adjMonth + 1, 1);
    const mTotalDays = new Date(targetYear, adjMonth + 1, 0).getDate();

    const mTxns = transactions.filter(t =>
      t.type === 'expense' &&
      VARIABLE_CATEGORIES.includes(t.category) &&
      parseDate(t.date) >= mStart &&
      parseDate(t.date) < mEnd
    );

    const mDaily = new Array(mTotalDays + 1).fill(0);
    mTxns.forEach(t => {
      const day = parseDate(t.date).getDate();
      if (day >= 1 && day <= mTotalDays) mDaily[day] += t.amount;
    });
    const mDaysLogged = mDaily.slice(1).filter(v => v > 0).length;
    if (mDaysLogged > baselineDaysLogged) baselineDaysLogged = mDaysLogged;
  }

  const currentDaysLogged = nonZeroTotals.length;
  const hasSufficientData = isCurrentMonth
    ? (baselineDaysLogged > 0 ? currentDaysLogged >= baselineDaysLogged : currentDaysLogged >= 3)
    : nonZeroTotals.length > 0;
  const hasBaseline = typicalMonthlySpending > 0;

  const projectedMonthlySpending = isCurrentMonth
    ? (nonZeroTotals.length < 3 && typicalMonthlySpending > 0 ? typicalMonthlySpending : dailySpending * totalDays)
    : variableTxns.reduce((sum, t) => sum + t.amount, 0);

  const spendingPacePercent = typicalMonthlySpending > 0
    ? Math.round((projectedMonthlySpending / typicalMonthlySpending) * 100)
    : 0;
  const isOverspending = spendingPacePercent > 115;

  const projectedBalance = currentBalance + projectedIncome
    - remainingVariableSpending - projectedFixedOutflow;

  return {
    dailySpending,
    projectedBalance,
    fixedBillsPending,
    isOverspending,
    spendingPacePercent,
    typicalMonthlySpending,
    projectedMonthlySpending,
    remainingDays,
    hasSufficientData,
    hasBaseline
  };
}

// Single source of truth for money formatting across the app: formatMoney,
// wrapped app-wide by formatCurrency in context/CurrencyContext.jsx. The
// input side of formatting lives in moneyInput.js and groups through us.
//
// *** INVARIANT (DR-0003): stored amounts are unit-neutral. ***
// A transaction saved as 1250000 must NEVER become 1250 anywhere in our
// read/write paths. Scaling happens at render time and only for display:
// formatMoney here, plus makeAmountCell in services/exportWorkbook.js when
// a cell has to show full VND. Scaling anywhere else is a DR-0003
// violation. tests/currency.test.js pins this with a dedicated DR-0003
// case.
//
// Display modes we render:
//   USD            — amount rendered verbatim, 2 decimals, comma grouping.
//   VND + 'scaled' — legacy behavior: amount is interpreted as thousands and
//                    multiplied by 1000 for display ("50" -> "50.000 VND").
//   VND + 'exact'  — amount rendered verbatim ("1250000" -> "1.250.000 VND").

// Digit-grouping separator per currency convention: dots for VND (vi-VN),
// commas for USD (en-US). We keep exactly one copy of it: formatMoney below
// and formatAmountDraft in moneyInput.js both group through groupDigits, so
// the string we render and the string the user types can never disagree on
// grouping.
export const GROUP_SEPARATOR = { USD: ',', VND: '.' };

export function groupDigits(digitString, currency = 'VND') {
  const sep = GROUP_SEPARATOR[currency] ?? '.';
  return digitString.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function formatMoney(amount, currency, vndDisplayMode = 'scaled') {
  if (typeof amount !== 'number' || !isFinite(amount)) {
    return formatMoney(0, currency, vndDisplayMode);
  }

  if (currency === 'VND') {
    const value = vndDisplayMode === 'exact' ? amount : amount * 1000;
    return `${groupDigits(String(Math.round(value)), currency)} VND`;
  }

  // USD keeps its 2-decimal minor part intact; only the integer part groups
  // ("1234.56" -> "1,234.56 USD").
  const [whole, frac] = amount.toFixed(2).split('.');
  return `${groupDigits(whole, currency)}.${frac} USD`;
}

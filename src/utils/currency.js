// Single source of truth for money formatting across the app.
//
// INVARIANT (DR-0003): stored amounts are unit-neutral. A transaction saved
// as 1250000 must NEVER become 1250 anywhere in read/write paths. Scaling
// happens here, at render time, and only for display.
//
// Display modes:
//   USD            — amount rendered verbatim, 2 decimals.
//   VND + 'scaled' — legacy behavior: amount is interpreted as thousands and
//                    multiplied by 1000 for display ("50" -> "50,000 VND").
//   VND + 'exact'  — amount rendered verbatim ("1250000" -> "1,250,000 VND").

export function formatMoney(amount, currency, vndDisplayMode = 'scaled') {
  if (typeof amount !== 'number' || !isFinite(amount)) {
    return formatMoney(0, currency, vndDisplayMode);
  }

  if (currency === 'VND') {
    const value = vndDisplayMode === 'exact' ? amount : amount * 1000;
    return `${Math.round(value).toLocaleString('en-US')} VND`;
  }

  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount)} USD`;
}

// Single source of truth for money formatting across the app.
//
// INVARIANT (DR-0003): stored amounts are unit-neutral. A transaction saved
// as 1250000 must NEVER become 1250 anywhere in read/write paths. Scaling
// happens here, at render time, and only for display.
//
// Display modes:
//   USD            — amount rendered verbatim, 2 decimals, comma grouping.
//   VND + 'scaled' — legacy behavior: amount is interpreted as thousands and
//                    multiplied by 1000 for display ("50" -> "50K VND").
//                    The K suffix is load-bearing: it is what keeps a value
//                    entered in thousands from reading as plain đồng.
//   VND + 'exact'  — amount rendered verbatim ("1250000" -> "1.250.000 VND").

// Digit-grouping separator per currency convention: dots for VND (vi-VN),
// commas for USD (en-US). Shared by the display formatter and MoneyInput so
// typed and stored representations can never disagree on grouping.
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
    if (vndDisplayMode === 'exact') {
      return `${groupDigits(String(Math.round(amount)), currency)} VND`;
    }
    // Scaled: the stored number is thousands of dong. Rendering the raw
    // scaled number with a K marker states the unit unambiguously — the
    // pre-V2 plain rendering ("1.250 VND") is exactly the confusion the
    // onboarding wizard exists to prevent.
    return `${groupDigits(String(Math.round(amount)), currency)}K VND`;
  }

  // USD keeps its 2-decimal minor part intact; only the integer part groups.
  const [whole, frac] = amount.toFixed(2).split('.');
  return `${groupDigits(whole, currency)}.${frac} USD`;
}

// Live money-input primitives shared by MoneyInput.jsx (and exercised
// directly by tests/moneyInput.test.js).
//
// Separation of concerns (extends DR-0003):
//   - The parent component owns the DRAFT value: a sanitized string of
//     digits with at most one '.' for currencies that have minor units.
//   - Grouping separators exist only in the rendered string and never enter
//     application state, so every persistence path keeps seeing plain
//     numeric data.
import { groupDigits } from './currency';

const DECIMAL_CHAR = { USD: '.', VND: null };

export function allowsDecimals(currency) {
  return DECIMAL_CHAR[currency] != null;
}

// Raw keystrokes -> canonical draft: digits only, a single decimal point
// where the currency supports one (',' is accepted as an alias for vi-VN
// keyboard layouts), at most two fraction digits, and no leading-zero runs.
// We deliberately leave a lone leading zero alone so "0.5" stays typeable
// in USD.
export function sanitizeAmountDraft(raw, currency) {
  const normalized = String(raw).replace(/,/g, '.').replace(/[^\d.]/g, '');
  let draft = allowsDecimals(currency) ? normalized : normalized.replace(/\./g, '');

  const dotIndex = draft.indexOf('.');
  if (dotIndex !== -1) {
    // Everything after the FIRST dot is fraction territory — we read later
    // dots as stray keystrokes/paste artifacts, not thousands separators,
    // because they'd otherwise render as a second dot inside the field.
    draft = `${draft.slice(0, dotIndex)}.${draft.slice(dotIndex + 1).replace(/\./g, '').slice(0, 2)}`;
  }

  return draft.replace(/^0+(?=\d)/, '');
}

// Render a draft for the screen: integer part digit-grouped, fraction part
// verbatim. The grouping comes from groupDigits in ./currency — the same
// helper formatMoney uses — which is our coupling to the display side: this
// field and every rendered amount in the app agree on separators because
// they share one implementation. Purely presentational: this output is
// never persisted.
export function formatAmountDraft(draft, currency) {
  const dotIndex = draft.indexOf('.');
  if (dotIndex === -1) return groupDigits(draft, currency);
  return `${groupDigits(draft.slice(0, dotIndex), currency)}.${draft.slice(dotIndex + 1)}`;
}

// Caret math operates on "significant" characters — digits, plus the
// decimal point for currencies that have one — because grouping separators
// appear and disappear as the draft grows. MoneyInput.jsx counts them in
// the raw keystroke first (significantCharsBefore), then maps that count
// back onto the reformatted display (caretForSignificantChars); comparing
// counts instead of raw offsets keeps the caret on the characters the user
// actually typed rather than on volatile positions in the formatted string.
// For integer-only currencies (VND) a dot is ALWAYS a volatile separator
// and must never anchor the caret — counting it would strand the cursor one
// character short every time the value crosses a thousand boundary.
const isSignificant = (ch, currency) =>
  /\d/.test(ch) || (allowsDecimals(currency) && ch === '.');

export function significantCharsBefore(text, caret, currency) {
  let count = 0;
  const limit = Math.min(caret ?? text.length, text.length);
  for (let i = 0; i < limit; i++) {
    if (isSignificant(text[i], currency)) count += 1;
  }
  return count;
}

export function caretForSignificantChars(text, count, currency) {
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (isSignificant(text[i], currency)) {
      seen += 1;
      if (seen === count) return i + 1;
    }
  }
  return text.length;
}

// Draft -> stored numeric value: the display-to-state boundary, and the
// one input MoneyInput hands to its onChange. Returns null for an
// empty/invalid draft so callers can route to their own validation
// messaging.
export function parseAmountDraft(draft) {
  if (!draft) return null;
  const parsed = Number(draft);
  return Number.isFinite(parsed) ? parsed : null;
}

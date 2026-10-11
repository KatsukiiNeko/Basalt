import { useLayoutEffect, useRef, useState } from 'react';
import {
  allowsDecimals,
  caretForSignificantChars,
  formatAmountDraft,
  parseAmountDraft,
  sanitizeAmountDraft,
  significantCharsBefore,
} from '../utils/moneyInput';

// Our live-formatted money input.
//
// We keep it presentation-only: it owns the sanitized DRAFT string it needs
// to render grouped digits while typing, but reports plain numbers upward
// through onChange(number | null). Nothing formatted ever reaches
// application state (see DR-0003 in utils/currency.js).
//
// The parent seeds the field with initialValue. Programmatic resets (e.g.
// switching the form into edit mode) have to remount through a changing
// `key` rather than mutating props mid-edit, or the draft fights the parent.
const MoneyInput = ({ currency, initialValue = '', onChange, ...rest }) => {
  const [draft, setDraft] = useState(() => sanitizeAmountDraft(initialValue ?? '', currency));
  const inputRef = useRef(null);
  // Caret position we apply once React commits the reformatted value.
  const pendingCaret = useRef(null);

  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const handleChange = (e) => {
    const raw = e.target.value;
    // We count the typed-significant characters (digits plus the currency's
    // real decimal point) up to the caret, then find that same count in the
    // reformatted string — this is what keeps the caret glued to the digits
    // being edited instead of jumping to the end every time a grouping
    // separator appears. For VND the dot is only ever a separator, so it
    // must not count as significant.
    const sigCount = significantCharsBefore(raw, e.target.selectionStart, currency);
    const nextDraft = sanitizeAmountDraft(raw, currency);
    const display = formatAmountDraft(nextDraft, currency);
    pendingCaret.current = caretForSignificantChars(display, sigCount, currency);

    setDraft(nextDraft);
    onChange?.(parseAmountDraft(nextDraft));
  };

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode={allowsDecimals(currency) ? 'decimal' : 'numeric'}
      value={formatAmountDraft(draft, currency)}
      onChange={handleChange}
    />
  );
};

export default MoneyInput;

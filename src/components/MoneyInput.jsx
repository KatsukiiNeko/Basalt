import { useLayoutEffect, useRef, useState } from 'react';
import {
  allowsDecimals,
  caretForSignificantChars,
  dongToThousandsDraft,
  formatAmountDraft,
  parseAmountDraft,
  sanitizeAmountDraft,
  significantCharsBefore,
  thousandsToDongDraft,
} from '../utils/moneyInput';

// Live-formatted money input.
//
// Presentation-only component: it owns the sanitized DRAFT string needed to
// render grouped digits while typing, but reports plain numbers upward via
// onChange(number | null). Nothing formatted ever reaches application state
// (see DR-0003 in utils/currency.js).
//
// The parent seeds the field with initialValue. Programmatic resets (e.g.
// switching the form into edit mode) should remount via a changing `key`
// rather than mutating props mid-edit, so the draft never fights the parent.
//
// scaleThousands (scaled VND only): the user types in thousands, then the
// field expands to the đồng amount on blur/Enter — type 1, leave the field,
// read 1.000. From then on the text is ordinary đồng: editing 1.000 to
// 1.500 saves 1.5 thousand, which renders as 1.500 VND.
const MoneyInput = ({ currency, initialValue = '', onChange, scaleThousands = false, onBlur, onKeyDown, ...rest }) => {
  const [draft, setDraft] = useState(() => sanitizeAmountDraft(initialValue ?? '', currency));
  const [dongDraft, setDongDraft] = useState(() =>
    scaleThousands && initialValue !== '' ? thousandsToDongDraft(String(initialValue)) : ''
  );
  const resolved = scaleThousands && dongDraft !== '';
  const inputRef = useRef(null);
  // Caret position to apply after React commits the reformatted value.
  const pendingCaret = useRef(null);

  useLayoutEffect(() => {
    if (pendingCaret.current != null && inputRef.current) {
      inputRef.current.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  });

  const handleChange = (e) => {
    const raw = e.target.value;
    // Count typed-significant characters (digits + the currency's real
    // decimal point) up to the caret, then find the same count in the
    // reformatted string. This is what keeps the caret glued to the digits
    // the user is editing instead of jumping to the end every time a
    // grouping separator appears. For VND the dot is only ever a separator,
    // so it must not count as significant.
    const sigCount = significantCharsBefore(raw, e.target.selectionStart, currency);

    if (resolved) {
      const nextDong = sanitizeAmountDraft(raw, 'VND');
      const display = formatAmountDraft(nextDong, 'VND');
      pendingCaret.current = caretForSignificantChars(display, sigCount, 'VND');

      setDongDraft(nextDong);
      // Clearing the field returns it to thousand-typing for the next value.
      if (!nextDong) setDraft('');
      onChange?.(parseAmountDraft(dongToThousandsDraft(nextDong)));
      return;
    }

    const nextDraft = sanitizeAmountDraft(raw, currency);
    const display = formatAmountDraft(nextDraft, currency);
    pendingCaret.current = caretForSignificantChars(display, sigCount, currency);

    setDraft(nextDraft);
    onChange?.(parseAmountDraft(nextDraft));
  };

  const expandToDong = () => {
    if (!scaleThousands || resolved || !draft) return;
    setDongDraft(thousandsToDongDraft(draft));
  };

  return (
    <input
      {...rest}
      ref={inputRef}
      type="text"
      inputMode={allowsDecimals(currency) ? 'decimal' : 'numeric'}
      value={formatAmountDraft(resolved ? dongDraft : draft, currency)}
      onChange={handleChange}
      onBlur={(e) => {
        expandToDong();
        onBlur?.(e);
      }}
      onKeyDown={(e) => {
        // Enter submits without necessarily blurring; expand first so the
        // value the user sees is the value the ledger will show.
        if (e.key === 'Enter') expandToDong();
        onKeyDown?.(e);
      }}
    />
  );
};

export default MoneyInput;

import { describe, it, expect } from 'vitest';
import {
  allowsDecimals,
  sanitizeAmountDraft,
  formatAmountDraft,
  significantCharsBefore,
  caretForSignificantChars,
  parseAmountDraft
} from '../src/utils/moneyInput';

describe('allowsDecimals', () => {
  it('VND is integer-only; USD has minor units', () => {
    expect(allowsDecimals('VND')).toBe(false);
    expect(allowsDecimals('USD')).toBe(true);
  });
});

describe('sanitizeAmountDraft — VND (integer only)', () => {
  it.each([
    ['1000100', '1000100'],
    ['1.000.100', '1000100'], // pasted formatted text collapses to digits
    ['12.5', '125'],          // dots stripped for VND (separators only)
    ['abc', ''],
    ['', '']
  ])('%p -> %p', (raw, expected) => {
    expect(sanitizeAmountDraft(raw, 'VND')).toBe(expected);
  });
});

describe('sanitizeAmountDraft — USD (max 2 fraction digits)', () => {
  it('keeps a single decimal point and truncates extra fraction digits', () => {
    expect(sanitizeAmountDraft('12.34', 'USD')).toBe('12.34');
    expect(sanitizeAmountDraft('12.345', 'USD')).toBe('12.34'); // no rounding surprises mid-typing
  });

  it('collapses stray dots after the first into nothing, never a second dot', () => {
    expect(sanitizeAmountDraft('1.2.3', 'USD')).toBe('1.23');
    expect(sanitizeAmountDraft('1..2', 'USD')).toBe('1.2');
  });

  it('accepts comma as decimal alias (vi-VN keyboards)', () => {
    expect(sanitizeAmountDraft('12,5', 'USD')).toBe('12.5');
  });

  it('keeps a lone leading zero typeable so "0.5" is reachable', () => {
    expect(sanitizeAmountDraft('0', 'USD')).toBe('0');
    expect(sanitizeAmountDraft('0.', 'USD')).toBe('0.');
    expect(sanitizeAmountDraft('0.5', 'USD')).toBe('0.5');
  });

  it('collapses zero-runs once real digits follow', () => {
    expect(sanitizeAmountDraft('00', 'USD')).toBe('0');
    expect(sanitizeAmountDraft('007', 'USD')).toBe('7');
    expect(sanitizeAmountDraft('000123', 'USD')).toBe('123');
  });
});

describe('formatAmountDraft', () => {
  it('groups VND drafts with dots', () => {
    expect(formatAmountDraft('1000100', 'VND')).toBe('1.000.100');
  });

  it('groups USD integer part and leaves the fraction verbatim while typing', () => {
    // Fraction stays un-grouped/un-padded mid-edit: "12.5" must not become
    // "12.50" under the user's caret.
    expect(formatAmountDraft('12.5', 'USD')).toBe('12.5');
    expect(formatAmountDraft('12345.67', 'USD')).toBe('12,345.67');
    expect(formatAmountDraft('0.', 'USD')).toBe('0.');
  });
});

describe('caret math (significant-character anchoring)', () => {
  it('counts digits + decimal char, ignoring grouping separators', () => {
    // "1,234,567" has 7 digits but 9 chars; commas are volatile.
    expect(significantCharsBefore('1,234,567', 9, 'USD')).toBe(7);
    expect(significantCharsBefore('12.5', 4, 'USD')).toBe(4); // '.' counts for USD
  });

  it('for VND the dot is ONLY a separator and never anchors the caret', () => {
    // "1.999" — the dot must not be counted, or carets strand mid-string.
    expect(significantCharsBefore('1.999', 5, 'VND')).toBe(4);
    expect(significantCharsBefore('999', 3, 'VND')).toBe(3);
  });

  it('clamps out-of-range carets', () => {
    expect(significantCharsBefore('125', 99, 'VND')).toBe(3);
    expect(significantCharsBefore('125', undefined, 'USD')).toBe(3);
  });

  it('maps a significant-char count back to an offset in the reformatted string', () => {
    expect(caretForSignificantChars('12,345.67', 8, 'USD')).toBe(9);
    expect(caretForSignificantChars('12.5', 2, 'USD')).toBe(2);
    expect(caretForSignificantChars('12.5', 4, 'USD')).toBe(4);
  });

  it('round-trips caret across a VND thousand-boundary reformat (the regression)', () => {
    // Models handleChange exactly: caret math runs on the POST-keystroke
    // raw value and selection, not the pre-typing display. Typing "1"
    // between the digits of "999" (caret was at offset 1):
    const raw = '9199';
    const sig = significantCharsBefore(raw, 2, 'VND'); // 2 digits before caret
    const display = formatAmountDraft(sanitizeAmountDraft(raw, 'VND'), 'VND');
    expect(display).toBe('9.199');
    // Old dot-counting code returned 2 here — stranding the caret on the
    // freshly inserted separator instead of after the typed digit.
    expect(caretForSignificantChars(display, sig, 'VND')).toBe(3);
  });

  it('keeps the caret glued through repeated keystrokes (simulation)', () => {
    // Type "1234567" one key at a time into an empty VND field, caret
    // always at end; every step must land the caret after the last digit.
    let raw = '';
    let caret = 0;
    for (const digit of ['1', '2', '3', '4', '5', '6', '7']) {
      raw += digit;
      caret += 1;
      const sig = significantCharsBefore(raw, caret, 'VND');
      const display = formatAmountDraft(sanitizeAmountDraft(raw, 'VND'), 'VND');
      expect(caretForSignificantChars(display, sig, 'VND')).toBe(display.length);
    }
    expect(formatAmountDraft(sanitizeAmountDraft(raw, 'VND'), 'VND')).toBe('1.234.567');
  });

  it('returns string length when the count exceeds available significant chars', () => {
    expect(caretForSignificantChars('12', 10, 'VND')).toBe(2);
    expect(caretForSignificantChars('', 0, 'USD')).toBe(0);
  });
});

describe('parseAmountDraft (display -> stored boundary)', () => {
  it('converts drafts to numbers without ever keeping formatted text in state', () => {
    expect(parseAmountDraft('1000100')).toBe(1000100);
    expect(parseAmountDraft('12.5')).toBe(12.5);
    expect(parseAmountDraft('')).toBeNull();
  });

  it('returns null for non-finite results so validation can message instead', () => {
    expect(parseAmountDraft('abc')).toBeNull();
  });
});

describe('sanitize -> format -> parse round-trip', () => {
  it('a typed formatted string never leaks separators into stored state', () => {
    const typed = '1.000.100';           // what a paste or keystrokes produced on screen
    const draft = sanitizeAmountDraft(typed, 'VND');
    const display = formatAmountDraft(draft, 'VND');

    expect(display).toBe('1.000.100'); // presentation
    expect(draft).toBe('1000100');     // state: plain digits
    expect(parseAmountDraft(draft)).toBe(1000100); // storage-bound value
  });
});

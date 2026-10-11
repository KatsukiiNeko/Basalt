import { useEffect, useRef, useCallback } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Our shared modal/dialog primitive: overlay + panel + focus management.
// Every layered surface we stack — the Settings slide-over, ConfirmDialog,
// future sheets — goes through this, so keyboard behavior is right once,
// everywhere:
//  - Tab is trapped inside the dialog (background content is inert)
//  - Escape closes
//  - focus is restored to the pre-dialog element on close
//  - overlay scroll is locked
// The trap is not a convenience: a background tab stop can put the Enter
// key on invisible form controls — destructive for a finance app.
export default function Modal({
  isOpen,
  onClose,
  className = '',
  overlayClassName = '',
  labelledBy,
  children,
  focusOnOpenSelector,
  restoreFocus = true,
}) {
  const panelRef = useRef(null);
  const restoreRef = useRef(null);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;

    const panel = panelRef.current;
    if (!panel) return;

    const focusable = panel.querySelectorAll(FOCUSABLE);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    } else if (!panel.contains(active)) {
      e.preventDefault();
      first.focus();
    }
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return;

    if (restoreFocus) {
      restoreRef.current = document.activeElement;
    }

    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', handleKeyDown, true);

    // We put initial focus inside the dialog: the requested element wins
    // (focusOnOpenSelector, e.g. the safe-action button); otherwise the
    // first focusable — never the panel container itself, which Tab skips.
    const panel = panelRef.current;
    if (panel) {
      const target = focusOnOpenSelector
        ? panel.querySelector(focusOnOpenSelector)
        : panel.querySelector(FOCUSABLE);
      (target || panel).focus();
    }

    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleKeyDown, true);
      if (restoreFocus && restoreRef.current?.focus) {
        restoreRef.current.focus();
      }
    };
    // We only re-run on isOpen: handleKeyDown is stable via
    // useCallback(onClose), and the selectors are static per usage site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className={overlayClassName || 'modal-overlay'}
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className={className}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

import { useEffect, useRef } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

// Shared modal primitive built on the native <dialog> element: showModal()
// makes the page inert, traps Tab, and Escape emits a cancellable event.
// Focus is restored to the pre-dialog element on close.
export default function Modal({
  isOpen,
  onClose,
  className = '',
  overlayClassName = '',
  labelledBy,
  children,
  focusOnOpenSelector,
  restoreFocus = true,
  dismissible = true,
}) {
  const dialogRef = useRef(null);
  const restoreRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    restoreRef.current = restoreFocus ? document.activeElement : null;
    if (!dialog.open) dialog.showModal();

    const target = focusOnOpenSelector
      ? dialog.querySelector(focusOnOpenSelector)
      : dialog.querySelector(FOCUSABLE);
    (target || dialog).focus();

    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';

    // Escape always stays inside the dialog; only dismissible dialogs close.
    const handleCancel = (e) => {
      e.preventDefault();
      if (dismissible) onClose();
    };
    dialog.addEventListener('cancel', handleCancel);

    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      document.documentElement.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
      if (restoreFocus && restoreRef.current?.focus) {
        restoreRef.current.focus();
      }
    };
  }, [isOpen, onClose, focusOnOpenSelector, restoreFocus, dismissible]);

  if (!isOpen) return null;

  return (
    <dialog
      ref={dialogRef}
      className={overlayClassName || 'modal-overlay'}
      aria-labelledby={labelledBy}
      onClick={(e) => {
        if (dismissible && e.target === dialogRef.current) onClose();
      }}
    >
      <div className={className} role="document" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </dialog>
  );
}

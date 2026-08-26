import { useEffect, useRef } from 'react';
import { useLanguage } from '../context/LanguageContext';

// Destructive-action confirmation. Focus lands on Cancel (the safe action);
// Escape and backdrop clicks cancel.
const ConfirmDialog = ({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) => {
  const { t } = useLanguage();
  const cancelRef = useRef(null);

  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handleEscape);
    // Keyboard users must land inside the dialog instead of on the page
    // behind it; default to the safe action rather than the destructive one.
    cancelRef.current?.focus();
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div className="confirm-dialog-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h3 id="confirm-dialog-title">{title}</h3>
        <p id="confirm-dialog-message">{message}</p>
        <div className="confirm-dialog-actions">
          <button ref={cancelRef} className="confirm-cancel" onClick={onCancel}>
            {cancelLabel || t('accounts.cancel')}
          </button>
          <button className="confirm-ok" onClick={onConfirm}>
            {confirmLabel || t('confirm.continue')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;

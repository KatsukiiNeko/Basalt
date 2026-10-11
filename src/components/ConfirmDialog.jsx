import { useRef } from 'react';
import Modal from './Modal';
import { useLanguage } from '../context/LanguageContext';

// Destructive-action confirmation, built on our shared Modal primitive
// (components/Modal.jsx) so the Tab trap, Escape handling, focus restore
// and scroll lock come from there instead of being re-wired per dialog.
//
// The one thing we own is where focus lands: focusOnOpenSelector points
// at .confirm-cancel, the safe action, so an impatient Enter presses
// Cancel rather than whatever destructive thing the caller is confirming.
// Escape and backdrop clicks both go through onClose, which we wire to
// onCancel — there is no path through this dialog that confirms without
// an explicit press of the confirm button. Labels fall back to
// accounts.cancel / confirm.continue when the caller passes none.
const ConfirmDialog = ({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel }) => {
  const { t } = useLanguage();
  const cancelRef = useRef(null);

  return (
    <Modal
      isOpen
      onClose={onCancel}
      overlayClassName="confirm-overlay"
      className="confirm-dialog"
      labelledBy="confirm-dialog-title"
      focusOnOpenSelector=".confirm-cancel"
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
    </Modal>
  );
};

export default ConfirmDialog;

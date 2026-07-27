import React, { useId, useRef } from 'react';
import useFocusTrap from '../../hooks/useFocusTrap';
import Button from './Button';
import Icon from './Icon';

export default function Modal({
  open,
  variant = 'dialog',
  title,
  description,
  children,
  actions,
  onClose,
  busy = false,
  initialFocusRef,
  ariaLabel,
  className = '',
}) {
  const containerRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  const safeVariant = variant === 'palette' ? 'palette' : 'dialog';
  const showHeader = Boolean(title) || (safeVariant === 'dialog' && Boolean(onClose));

  useFocusTrap({
    active: open,
    containerRef,
    initialFocusRef,
    onEscape: busy ? undefined : onClose,
  });

  if (!open) return null;

  return (
    <div className={['modal-layer', className].filter(Boolean).join(' ')}>
      <button
        className="modal__scrim"
        type="button"
        tabIndex={-1}
        disabled={busy}
        aria-label="Close dialog"
        onClick={busy ? undefined : onClose}
      />
      <section
        ref={containerRef}
        className={['modal__surface', `modal--${safeVariant}`, busy ? 'is-busy' : ''].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-busy={busy || undefined}
        aria-label={!title ? ariaLabel : undefined}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        {showHeader ? (
          <header className="modal__header">
            <div>
              {title ? <h2 id={titleId}>{title}</h2> : null}
              {description ? <p id={descriptionId}>{description}</p> : null}
            </div>
            {onClose ? (
              <Button
                variant="icon"
                size="sm"
                aria-label="Close dialog"
                disabled={busy}
                onClick={onClose}
              >
                <Icon name="close" />
              </Button>
            ) : null}
          </header>
        ) : null}
        <div className="modal__body">{children}</div>
        {actions ? <footer className="modal__actions">{actions}</footer> : null}
      </section>
    </div>
  );
}

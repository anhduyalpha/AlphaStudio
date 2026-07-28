import React, {
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import useFocusTrap from '../hooks/useFocusTrap';
import Button from './Button';
import Icon from './Icon';

function parseDuration(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === 's' ? amount * 1000 : amount;
}

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
  const [rendered, setRendered] = useState(Boolean(open));
  const [phase, setPhase] = useState(open ? 'enter' : 'idle');
  const safeVariant = variant === 'palette' ? 'palette' : 'dialog';
  const hasTitle = typeof title === 'string' ? Boolean(title.trim()) : Boolean(title);
  const accessibleLabel = typeof ariaLabel === 'string' ? ariaLabel.trim() : '';
  const showHeader = hasTitle || (safeVariant === 'dialog' && Boolean(onClose));

  if (open && !hasTitle && !accessibleLabel) {
    throw new Error('Modal requires a non-empty title or ariaLabel while open.');
  }

  useEffect(() => {
    if (open) {
      setRendered(true);
      setPhase('enter');
    } else if (rendered) {
      setPhase('exit');
    }
  }, [open, rendered]);

  useEffect(() => {
    if (open || !rendered || phase !== 'exit') return undefined;
    const element = containerRef.current;
    const duration = element && typeof getComputedStyle === 'function'
      ? parseDuration(getComputedStyle(element).getPropertyValue('--duration-slow'))
      : 0;
    if (duration <= 0) {
      setRendered(false);
      return undefined;
    }
    const timer = window.setTimeout(() => setRendered(false), duration);
    return () => window.clearTimeout(timer);
  }, [open, phase, rendered]);

  useFocusTrap({
    active: open && rendered,
    containerRef,
    initialFocusRef,
    onEscape: busy ? undefined : onClose,
  });

  if (!rendered) return null;

  return (
    <div
      className={[
        'modal-layer',
        `modal-layer--${phase}`,
        className,
      ].filter(Boolean).join(' ')}
      aria-hidden={!open ? 'true' : undefined}
    >
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
        aria-label={!hasTitle ? accessibleLabel : undefined}
        aria-labelledby={hasTitle ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onAnimationEnd={(event) => {
          if (!open && phase === 'exit' && event.target === event.currentTarget) {
            setRendered(false);
          }
        }}
      >
        {showHeader ? (
          <header className="modal__header">
            <div>
              {hasTitle ? <h2 id={titleId}>{title}</h2> : null}
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

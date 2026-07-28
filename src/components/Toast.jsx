import React, { useCallback, useEffect, useRef, useState } from 'react';
import Button from './Button';
import Icon from './Icon';

const TONES = new Set(['notice', 'success', 'danger']);

export function parseCssDuration(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)(ms|s)$/);
  if (!match) return 0;
  const amount = Number(match[1]);
  return match[2] === 's' ? amount * 1000 : amount;
}

function readDuration(element, token) {
  if (!element || typeof getComputedStyle !== 'function') return 0;
  return parseCssDuration(getComputedStyle(element).getPropertyValue(token));
}

export function ToastRegion({ children, className = '', ...props }) {
  return (
    <div
      {...props}
      className={['toast-region', className].filter(Boolean).join(' ')}
      role="status"
      aria-live="polite"
      aria-atomic="false"
    >
      {children}
    </div>
  );
}

export default function Toast({
  tone = 'notice',
  children,
  onDismiss,
  autoDismiss = true,
  className = '',
  ...props
}) {
  const ref = useRef(null);
  const timerRef = useRef(null);
  const [phase, setPhase] = useState('enter');
  const [visible, setVisible] = useState(true);
  const safeTone = TONES.has(tone) ? tone : 'notice';

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const beginExit = useCallback(() => {
    clearTimer();
    setPhase('exit');
    const exitDuration = readDuration(ref.current, '--duration-base');
    if (exitDuration > 0) {
      timerRef.current = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, exitDuration);
    } else {
      setVisible(false);
      onDismiss?.();
    }
  }, [clearTimer, onDismiss]);

  useEffect(() => {
    if (!autoDismiss) return undefined;
    const totalDuration = readDuration(ref.current, '--duration-toast');
    const exitDuration = readDuration(ref.current, '--duration-base');
    if (totalDuration > 0) {
      timerRef.current = setTimeout(beginExit, Math.max(0, totalDuration - exitDuration));
    }
    return clearTimer;
  }, [autoDismiss, beginExit, clearTimer]);

  if (!visible) return null;

  return (
    <div
      {...props}
      ref={ref}
      className={[
        'toast',
        `toast--${safeTone}`,
        `toast--${phase}`,
        className,
      ].filter(Boolean).join(' ')}
    >
      <span className="toast__icon" aria-hidden="true">
        <Icon name={safeTone === 'success' ? 'completed' : safeTone === 'danger' ? 'failed' : 'file'} />
      </span>
      <div className="toast__copy">{children}</div>
      {onDismiss ? (
        <Button
          variant="icon"
          size="sm"
          aria-label="Dismiss notification"
          onClick={beginExit}
        >
          <Icon name="close" />
        </Button>
      ) : null}
    </div>
  );
}

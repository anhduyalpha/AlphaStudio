import React from 'react';
import ProgressBar from './ProgressBar';

export default function RunBar({
  status,
  progress,
  indeterminate = false,
  primaryAction,
  secondaryAction,
  busy = false,
  disabled = false,
  className = '',
  ...props
}) {
  const hasProgress = indeterminate || progress !== undefined;
  const safePrimaryAction = disabled && React.isValidElement(primaryAction)
    ? React.cloneElement(primaryAction, { disabled: true })
    : primaryAction;
  return (
    <section
      {...props}
      className={[
        'run-bar',
        busy ? 'is-loading' : '',
        disabled ? 'is-disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-label="Run actions"
      aria-busy={busy || undefined}
      aria-disabled={disabled || undefined}
    >
      <div className="run-bar__status">
        {status ? <span>{status}</span> : null}
        {hasProgress ? (
          <ProgressBar
            variant={indeterminate ? 'indeterminate' : 'determinate'}
            value={progress}
            announce={false}
          />
        ) : null}
      </div>
      <div className="run-bar__actions">
        {secondaryAction}
        {safePrimaryAction}
      </div>
    </section>
  );
}

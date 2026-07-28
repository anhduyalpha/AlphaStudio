import React from 'react';
import Button from './Button';
import Icon from './Icon';

export default function ErrorState({
  title = 'Something went wrong',
  message,
  actionLabel,
  onAction,
  actionDisabled = false,
  className = '',
  ...props
}) {
  if (!actionLabel || typeof onAction !== 'function') {
    throw new Error('ErrorState requires a named recovery action and onAction handler.');
  }

  return (
    <section
      {...props}
      className={['error-state', className].filter(Boolean).join(' ')}
      role="alert"
    >
      <span className="error-state__icon" aria-hidden="true">
        <Icon name="failed" />
      </span>
      <div className="error-state__copy">
        <h3>{title}</h3>
        {message ? <p>{message}</p> : null}
      </div>
      <Button
        variant="secondary"
        size="sm"
        disabled={actionDisabled}
        onClick={onAction}
      >
        {actionLabel}
      </Button>
    </section>
  );
}

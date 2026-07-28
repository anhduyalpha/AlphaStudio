import React from 'react';

const TONES = new Set(['neutral', 'live', 'success', 'warning', 'danger']);

export default function StatusBadge({
  tone = 'neutral',
  children,
  className = '',
  ...props
}) {
  const safeTone = TONES.has(tone) ? tone : 'neutral';
  const liveProps = safeTone === 'live'
    ? { role: 'status', 'aria-live': 'polite' }
    : {};

  return (
    <span
      {...liveProps}
      {...props}
      className={['status-badge', `status-badge--${safeTone}`, className].filter(Boolean).join(' ')}
    >
      <span className="status-badge__dot" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

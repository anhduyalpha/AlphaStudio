import React from 'react';

export function clampProgress(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(100, Math.max(0, numeric)) : 0;
}

export default function ProgressBar({
  variant = 'determinate',
  value = 0,
  label = 'Progress',
  announce = true,
  reduced = false,
  className = '',
  ...props
}) {
  const indeterminate = variant === 'indeterminate';
  const safeValue = clampProgress(value);
  const semantics = announce
    ? {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': indeterminate ? undefined : safeValue,
      }
    : { 'aria-hidden': 'true' };

  return (
    <div
      {...props}
      {...semantics}
      className={[
        'progress-bar',
        indeterminate ? 'progress-bar--indeterminate' : 'progress-bar--determinate',
        reduced ? 'is-reduced' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      <span
        className="progress-bar__fill"
        style={indeterminate ? undefined : { '--progress-scale': safeValue / 100 }}
      />
    </div>
  );
}

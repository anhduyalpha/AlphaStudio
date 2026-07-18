import React from 'react';
import { emptyIllustrations, emptyStateCopy } from '../assets/registry';

export default function EmptyState({
  type = 'noResults',
  title,
  description,
  action = null,
  compact = false,
  className = '',
  live = false,
}) {
  const copy = emptyStateCopy[type] || emptyStateCopy.noResults;
  const src = emptyIllustrations[type] || emptyIllustrations.noResults;

  return (
    <div
      className={`alpha-empty-state${compact ? ' is-compact' : ''} ${className}`.trim()}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <img src={src} alt="" width="480" height="300" loading="lazy" aria-hidden="true" />
      <div className="alpha-empty-copy">
        <strong>{title || copy.title}</strong>
        <p>{description || copy.description}</p>
        {action ? <div className="alpha-empty-action">{action}</div> : null}
      </div>
    </div>
  );
}

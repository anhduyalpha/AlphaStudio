import React from 'react';

export default function Skeleton({
  variant = 'block',
  lines = 3,
  className = '',
  label = 'Loading',
}) {
  const safeVariant = variant === 'row' ? 'row' : 'block';
  const count = safeVariant === 'row' ? Math.max(1, lines) : 1;

  return (
    <span className="skeleton-wrap" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <span
          key={index}
          className={[
            'skeleton',
            `skeleton--${safeVariant}`,
            index === count - 1 ? 'skeleton--last' : '',
            className,
          ].filter(Boolean).join(' ')}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

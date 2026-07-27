import React from 'react';

export default function EmptyState({
  variant = 'default',
  title,
  description,
  visual,
  action,
  live = false,
  className = '',
  ...props
}) {
  return (
    <div
      {...props}
      {...(live ? { role: 'status', 'aria-live': 'polite' } : {})}
      className={[
        'empty-state',
        variant === 'compact' ? 'empty-state--compact' : 'empty-state--default',
        className,
      ].filter(Boolean).join(' ')}
    >
      {visual ? <div className="empty-state__visual" aria-hidden="true">{visual}</div> : null}
      <div className="empty-state__copy">
        <h3 className="empty-state__title">{title}</h3>
        {description ? <p className="empty-state__description">{description}</p> : null}
      </div>
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

import React from 'react';

export default function Banner({
  tone = 'neutral',
  title,
  icon,
  actions,
  children,
  className = '',
  ...props
}) {
  const safeTone = tone === 'warning' ? 'warning' : 'neutral';
  return (
    <div
      {...props}
      role="status"
      className={['banner', `banner--${safeTone}`, className].filter(Boolean).join(' ')}
    >
      {icon ? <span className="banner__icon" aria-hidden="true">{icon}</span> : null}
      <div className="banner__copy">
        {title ? <strong className="banner__title">{title}</strong> : null}
        <div className="banner__body">{children}</div>
      </div>
      {actions ? <div className="banner__actions">{actions}</div> : null}
    </div>
  );
}

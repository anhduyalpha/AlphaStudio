import React from 'react';

export default function Card({
  as,
  variant = 'panel',
  title,
  subtitle,
  header,
  actions,
  interactive = false,
  className = '',
  children,
  ...props
}) {
  const Component = as || (interactive ? 'button' : 'section');
  const safeVariant = variant === 'flat' ? 'flat' : 'panel';
  const buttonProps = Component === 'button' ? { type: 'button' } : {};
  const hasHeader = header || title || subtitle || actions;

  return (
    <Component
      {...buttonProps}
      {...props}
      className={[
        'card',
        `card--${safeVariant}`,
        interactive ? 'is-interactive' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {hasHeader ? (
        <div className="card__header">
          <div className="card__heading">
            {header || (
              <>
                {title ? <h3 className="card__title">{title}</h3> : null}
                {subtitle ? <p className="card__subtitle">{subtitle}</p> : null}
              </>
            )}
          </div>
          {actions ? <div className="card__actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="card__body">{children}</div>
    </Component>
  );
}

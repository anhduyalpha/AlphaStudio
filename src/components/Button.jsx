import React, { forwardRef } from 'react';
import Icon from './Icon';

const VARIANTS = new Set(['primary', 'secondary', 'ghost', 'danger', 'icon']);
const SIZES = new Set(['sm', 'md']);

const Button = forwardRef(function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon,
  iconPosition = 'start',
  children,
  className = '',
  disabled = false,
  type = 'button',
  ...props
}, ref) {
  const safeVariant = VARIANTS.has(variant) ? variant : 'secondary';
  const safeSize = SIZES.has(size) ? size : 'md';
  const iconNode = typeof icon === 'string' ? <Icon name={icon} /> : icon;

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[
        'button',
        `button--${safeVariant}`,
        `button--${safeSize}`,
        busy ? 'is-busy' : '',
        className,
      ].filter(Boolean).join(' ')}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="button__spinner" aria-hidden="true" /> : null}
      <span className="button__content">
        {iconNode && iconPosition === 'start' ? <span className="button__icon">{iconNode}</span> : null}
        {children}
        {iconNode && iconPosition === 'end' ? <span className="button__icon">{iconNode}</span> : null}
      </span>
    </button>
  );
});

export default Button;

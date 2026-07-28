import React, { useState } from 'react';

export default function Toggle({
  checked,
  defaultChecked = false,
  onChange,
  label,
  description,
  disabled = false,
  className = '',
  ...props
}) {
  const controlled = checked !== undefined;
  const [internalChecked, setInternalChecked] = useState(defaultChecked);
  const selected = controlled ? checked : internalChecked;

  function toggle(event) {
    if (disabled) return;
    const next = !selected;
    if (!controlled) setInternalChecked(next);
    onChange?.(next, event);
  }

  return (
    <button
      {...props}
      type="button"
      role="switch"
      aria-checked={Boolean(selected)}
      className={[
        'toggle',
        selected ? 'is-selected' : '',
        className,
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={toggle}
    >
      <span className="toggle__copy">
        <span className="toggle__label">{label}</span>
        {description ? <span className="toggle__description">{description}</span> : null}
      </span>
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </button>
  );
}

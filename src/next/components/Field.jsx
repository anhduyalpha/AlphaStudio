import React, { useId } from 'react';

const VARIANTS = new Set(['text', 'select', 'textarea', 'color', 'range', 'checkbox']);

export default function Field({
  id: providedId,
  label,
  hint,
  error,
  variant = 'text',
  options = [],
  className = '',
  controlClassName = '',
  required = false,
  children,
  ...controlProps
}) {
  const generatedId = useId();
  const id = providedId || `field-${generatedId.replace(/:/g, '')}`;
  const safeVariant = VARIANTS.has(variant) ? variant : 'text';
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  const commonProps = {
    ...controlProps,
    id,
    className: `field__control ${controlClassName}`.trim(),
    required,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
  };

  let control;
  if (safeVariant === 'select') {
    control = (
      <select {...commonProps}>
        {children || options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else if (safeVariant === 'textarea') {
    control = <textarea {...commonProps} />;
  } else if (safeVariant === 'checkbox') {
    control = <input {...commonProps} type="checkbox" />;
  } else {
    control = <input {...commonProps} type={safeVariant} />;
  }

  return (
    <div
      className={[
        'field',
        `field--${safeVariant}`,
        error ? 'has-error' : '',
        controlProps.disabled ? 'is-disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
    >
      {safeVariant === 'checkbox' ? (
        <label className="field__checkbox-label" htmlFor={id}>
          {control}
          <span className="field__checkbox-box" aria-hidden="true" />
          <span>{label}{required ? <span className="field__required" aria-hidden="true"> *</span> : null}</span>
        </label>
      ) : (
        <>
          <label className="field__label" htmlFor={id}>
            {label}{required ? <span className="field__required" aria-hidden="true"> *</span> : null}
          </label>
          {control}
        </>
      )}
      {hint ? <span className="field__hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="field__error" id={errorId} role="alert">{error}</span> : null}
    </div>
  );
}

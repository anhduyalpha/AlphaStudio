import React from 'react';
import Icon from './Icon';
import StatusIcon from './StatusIcon';
import { WorkspaceHeader } from './Workbench';

/** @deprecated Prefer WorkspaceHeader — kept as thin adapter for gradual migration */
export function PageIntro({ eyebrow, title, description, actions, status, family }) {
  return (
    <WorkspaceHeader
      meta={eyebrow}
      title={title}
      description={description}
      actions={actions}
      status={status}
      family={family}
      className="page-intro"
    />
  );
}

export function PrimaryButton({
  children,
  icon = 'arrow',
  onClick,
  type = 'button',
  disabled = false,
  busy = false,
  size = 'md',
  className = '',
  ...rest
}) {
  return (
    <button
      className={`button button-primary liquid-press size-${size} ${className}`.trim()}
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      <span>{busy ? 'Working…' : children}</span>
      <Icon name={busy ? 'converting' : icon} size={size === 'sm' ? 16 : 18} />
    </button>
  );
}

export function SecondaryButton({
  children,
  icon,
  onClick,
  className = '',
  disabled = false,
  size = 'md',
  variant = 'secondary',
  ...rest
}) {
  return (
    <button
      className={`button button-${variant} liquid-press size-${size} ${className}`.trim()}
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function IconButton({ icon, label, onClick, disabled = false, className = '', ...rest }) {
  return (
    <button
      className={`icon-button liquid-press ${className}`.trim()}
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      {...rest}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

export function StatusBadge({ children, tone = 'neutral', live = false, status }) {
  const t = tone === 'danger' ? 'red' : tone;
  return (
    <span className={`status-badge tone-${t}${live ? ' is-live' : ''}`}>
      {status ? <StatusIcon status={status} /> : null}
      {children}
    </span>
  );
}

export function FileDropzone({
  title = 'Drop files here',
  subtitle = 'Drag and drop or browse from your computer',
  onClick,
  active = false,
  disabled = false,
}) {
  return (
    <button
      className={`file-dropzone liquid-drop${active ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
      type="button"
      onClick={onClick}
      disabled={disabled}
    >
      <div className="dropzone-icon">
        <Icon name="upload" size={25} />
      </div>
      <strong>{title}</strong>
      <span>{subtitle}</span>
      <small>Select files to process with the local API</small>
    </button>
  );
}

export function SelectField({ label, value, children, onChange, name, error, hint, id }) {
  const fieldId = id || name || (label ? `field-${String(label).toLowerCase().replace(/\s+/g, '-')}` : undefined);
  const controlled = typeof onChange === 'function';
  return (
    <label className={`field-group${error ? ' has-error' : ''}`} htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <select
        id={fieldId}
        name={name}
        {...(controlled ? { value: value ?? '', onChange } : { defaultValue: value })}
        aria-invalid={error ? true : undefined}
      >
        {children}
      </select>
      {hint && !error ? <small className="field-hint">{hint}</small> : null}
      {error ? <small className="field-error" role="alert">{error}</small> : null}
    </label>
  );
}

export function TextField({
  label,
  placeholder,
  defaultValue = '',
  value,
  onChange,
  name,
  type = 'text',
  autoComplete,
  error,
  hint,
  id,
}) {
  const fieldId = id || name || (label ? `field-${String(label).toLowerCase().replace(/\s+/g, '-')}` : undefined);
  return (
    <label className={`field-group${error ? ' has-error' : ''}`} htmlFor={fieldId}>
      <span className="field-label">{label}</span>
      <input
        id={fieldId}
        type={type}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-invalid={error ? true : undefined}
        {...(onChange ? { value: value ?? '', onChange } : { defaultValue })}
      />
      {hint && !error ? <small className="field-hint">{hint}</small> : null}
      {error ? <small className="field-error" role="alert">{error}</small> : null}
    </label>
  );
}

export function ToggleRow({
  title,
  description,
  defaultChecked = false,
  checked,
  onChange,
  disabled = false,
}) {
  const controlled = checked !== undefined;
  return (
    <label className={`toggle-row${disabled ? ' is-disabled' : ''}`}>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <input
        type="checkbox"
        role="switch"
        disabled={disabled}
        aria-checked={controlled ? Boolean(checked) : undefined}
        {...(controlled ? { checked: Boolean(checked), onChange } : { defaultChecked, onChange })}
      />
      <i aria-hidden="true" />
    </label>
  );
}

export function WorkspaceTabs({ tabs, active, onChange, label = 'Workspace modes' }) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
          tabIndex={active === tab ? 0 : -1}
          className={active === tab ? 'active' : ''}
          onClick={() => onChange(tab)}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

export function FeatureButton({ icon, title, description, active = false, onClick }) {
  return (
    <button
      className={`feature-action-button ${active ? 'active' : ''}`}
      type="button"
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="feature-action-icon"><Icon name={icon} size={19} /></span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <Icon name="arrow" size={16} />
    </button>
  );
}

export function FeatureRail({ items, active, onChange, label = 'Features' }) {
  return (
    <div className="feature-rail" role="listbox" aria-label={label}>
      {items.map((item) => {
        const key = item.id || item.title;
        const selected = active === key || active === item.title;
        return (
          <button
            key={key}
            type="button"
            role="option"
            aria-selected={selected}
            className={`feature-rail-item${selected ? ' active' : ''}`}
            onClick={() => onChange(item)}
          >
            {item.icon ? <Icon name={item.icon} size={18} /> : null}
            <span>
              <strong>{item.title}</strong>
              {item.description ? <small>{item.description}</small> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function IllustrationCard({ src, alt, eyebrow = 'Visual workspace', title, description }) {
  return (
    <article className="surface-card illustration-card">
      <img src={src} alt={alt} width="640" height="400" loading="lazy" />
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
    </article>
  );
}

export function Panel({ title, children, actions, className = '', as: Tag = 'section' }) {
  return (
    <Tag className={`surface-card panel-card ${className}`.trim()}>
      {(title || actions) ? (
        <div className="panel-card-head">
          {title ? <h2 className="panel-card-title">{title}</h2> : <span />}
          {actions ? <div className="panel-card-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="panel-card-body">{children}</div>
    </Tag>
  );
}

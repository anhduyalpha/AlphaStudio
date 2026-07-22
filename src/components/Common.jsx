import React from 'react';
import Icon from './Icon';
import StatusIcon from './StatusIcon';

export function PageIntro({ eyebrow, title, description, actions }) {
  return (
    <div className="page-intro">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
        <p className="intro-description">{description}</p>
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function PrimaryButton({ children, icon = 'arrow', onClick, type = 'button', disabled = false, ...rest }) {
  return (
    <button className="button button-primary" type={type} onClick={onClick} disabled={disabled} {...rest}>
      <span>{children}</span>
      <Icon name={icon} size={18} />
    </button>
  );
}

export function SecondaryButton({ children, icon, onClick, className = '', disabled = false, ...rest }) {
  return (
    <button className={`button button-secondary ${className}`} type="button" onClick={onClick} disabled={disabled} {...rest}>
      {icon ? <Icon name={icon} size={18} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function StatusBadge({ children, tone = 'neutral', live = false, status }) {
  // Map 'danger' alias used by converter results to existing 'red' / danger styling
  const t = tone === 'danger' ? 'red' : tone;
  return (
    <span className={`status-badge tone-${t}${live ? ' is-live' : ''}`}>
      {status ? <StatusIcon status={status} /> : null}
      {children}
    </span>
  );
}

export function FileDropzone({ title = 'Drop files here', subtitle = 'Drag and drop or browse from your computer', onClick }) {
  return (
    <button className="file-dropzone" type="button" onClick={onClick}>
      <div className="dropzone-icon">
        <Icon name="upload" size={25} />
      </div>
      <strong>{title}</strong>
      <span>{subtitle}</span>
      <small>Select files to process with the local API</small>
    </button>
  );
}

export function SelectField({ label, value, children, onChange, name }) {
  const controlled = typeof onChange === 'function';
  return (
    <label className="field-group">
      <span>{label}</span>
      <select
        name={name}
        {...(controlled ? { value: value ?? '', onChange } : { defaultValue: value })}
      >
        {children}
      </select>
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
}) {
  return (
    <label className="field-group">
      <span>{label}</span>
      <input
        type={type}
        name={name}
        placeholder={placeholder}
        autoComplete={autoComplete}
        {...(onChange ? { value: value ?? '', onChange } : { defaultValue })}
      />
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
        disabled={disabled}
        {...(controlled ? { checked: Boolean(checked), onChange } : { defaultChecked, onChange })}
      />
      <i aria-hidden="true" />
    </label>
  );
}

export function WorkspaceTabs({ tabs, active, onChange }) {
  return (
    <div className="workspace-tabs" role="tablist" aria-label="Workspace modes">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={active === tab}
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
    <button className={`feature-action-button ${active ? 'active' : ''}`} type="button" onClick={onClick}>
      <span className="feature-action-icon"><Icon name={icon} size={19} /></span>
      <span>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <Icon name="arrow" size={16} />
    </button>
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

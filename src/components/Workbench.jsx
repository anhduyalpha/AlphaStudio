import React from 'react';
import Icon from './Icon';

/**
 * WorkbenchLayout — structural regions for Studio Rail + Workbench patterns.
 * stage: primary object (files, canvas, timeline, editor)
 * rail: contextual settings / options
 * runbar: sticky primary actions + progress
 * footer: optional results strip
 */
export function WorkbenchLayout({
  stage,
  rail,
  runbar,
  footer,
  className = '',
  family = 'neutral',
  'data-testid': testId = 'workbench-layout',
}) {
  return (
    <div
      className={`workbench-layout family-${family} ${className}`.trim()}
      data-testid={testId}
      data-family={family}
    >
      <div className="workbench-body">
        <section className="workbench-stage" aria-label="Primary workspace">
          {stage}
        </section>
        {rail ? (
          <aside className="workbench-rail" aria-label="Workspace options">
            {rail}
          </aside>
        ) : null}
      </div>
      {runbar ? (
        <div className="workbench-runbar" role="region" aria-label="Run actions">
          {runbar}
        </div>
      ) : null}
      {footer ? <div className="workbench-footer">{footer}</div> : null}
    </div>
  );
}

/**
 * WorkspaceHeader — replaces marketing PageIntro for operational workspaces.
 */
export function WorkspaceHeader({
  title,
  meta,
  description,
  actions,
  status,
  family,
  className = '',
}) {
  return (
    <header className={`workspace-header ${family ? `family-${family}` : ''} ${className}`.trim()}>
      <div className="workspace-header-copy">
        {meta ? <p className="workspace-meta">{meta}</p> : null}
        <h1 className="workspace-title">{title}</h1>
        {description ? <p className="workspace-description">{description}</p> : null}
      </div>
      <div className="workspace-header-side">
        {status ? <div className="workspace-header-status">{status}</div> : null}
        {actions ? <div className="workspace-header-actions">{actions}</div> : null}
      </div>
    </header>
  );
}

export function CapabilityBanner({ title = 'Unavailable', reason, action }) {
  return (
    <div className="capability-banner" role="status">
      <Icon name="unavailable" size={18} />
      <div>
        <strong>{title}</strong>
        {reason ? <p>{reason}</p> : null}
      </div>
      {action ? <div className="capability-banner-action">{action}</div> : null}
    </div>
  );
}

export function ResultPanel({ title = 'Results', children, empty }) {
  return (
    <section className="result-panel" aria-label={title}>
      <div className="result-panel-head">
        <h2>{title}</h2>
      </div>
      <div className="result-panel-body">
        {children || empty || null}
      </div>
    </section>
  );
}

export function Skeleton({ lines = 3, className = '' }) {
  return (
    <div className={`skeleton-block ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="skeleton-line" style={{ width: `${88 - i * 12}%` }} />
      ))}
    </div>
  );
}

export function ProgressWave({ value = 0, label = 'Progress', indeterminate = false }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      className={`progress-wave${indeterminate ? ' is-indeterminate' : ''}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : clamped}
    >
      <div className="progress-wave-track">
        <div className="progress-wave-fill" style={indeterminate ? undefined : { width: `${clamped}%` }} />
      </div>
      {!indeterminate ? <span className="progress-wave-meta">{clamped}%</span> : null}
    </div>
  );
}

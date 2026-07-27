import React from 'react';
import Icon from './Icon';
import ProgressBar from './ProgressBar';

const STATUS = Object.freeze({
  ready: { icon: 'file', label: 'Ready' },
  uploading: { icon: 'uploading', label: 'Uploading', loading: true },
  inspecting: { icon: 'inspecting', label: 'Inspecting', loading: true },
  queued: { icon: 'queued', label: 'Queued', loading: true },
  converting: { icon: 'converting', label: 'Converting', loading: true },
  completed: { icon: 'completed', label: 'Completed' },
  warning: { icon: 'warning', label: 'Needs attention' },
  failed: { icon: 'failed', label: 'Failed', error: true },
  cancelled: { icon: 'cancelled', label: 'Cancelled' },
  unavailable: { icon: 'unavailable', label: 'Unavailable', error: true },
});

export function formatBytes(value) {
  const bytes = Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let size = bytes / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  const rounded = size >= 10 ? Math.round(size) : Math.round(size * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export default function FileRow({
  name,
  size,
  meta,
  status = 'ready',
  statusLabel,
  progress,
  actions,
  selected = false,
  disabled = false,
  className = '',
  ...props
}) {
  const state = STATUS[status] || STATUS.ready;
  const hasProgress = progress !== undefined && progress !== null;

  return (
    <article
      {...props}
      className={[
        'file-row',
        selected ? 'is-selected' : '',
        state.loading ? 'is-loading' : '',
        state.error ? 'has-error' : '',
        disabled ? 'is-disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-disabled={disabled || undefined}
      aria-current={selected ? 'true' : undefined}
    >
      <span className="file-row__status" title={statusLabel || state.label}>
        <Icon name={state.icon} label={statusLabel || state.label} />
      </span>
      <div className="file-row__body">
        <div className="file-row__heading">
          <strong className="file-row__name">{name}</strong>
          <span className="file-row__state">{statusLabel || state.label}</span>
        </div>
        <div className="file-row__meta">
          {meta || (size !== undefined ? formatBytes(size) : null)}
        </div>
        {hasProgress ? (
          <div className="file-row__progress">
            <ProgressBar
              value={progress}
              label={`${name || 'File'} ${statusLabel || state.label}`}
            />
          </div>
        ) : null}
      </div>
      {actions ? (
        <div
          className="file-row__actions"
          inert={disabled ? '' : undefined}
        >
          {actions}
        </div>
      ) : null}
    </article>
  );
}

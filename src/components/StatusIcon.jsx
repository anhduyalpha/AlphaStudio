import React from 'react';
import Icon from './Icon';

const statusMap = Object.freeze({
  upload: 'uploading',
  uploading: 'uploading',
  inspect: 'inspecting',
  inspecting: 'inspecting',
  detecting: 'inspecting',
  pending: 'queued',
  queued: 'queued',
  running: 'converting',
  processing: 'converting',
  converting: 'converting',
  ready: 'completed',
  success: 'completed',
  completed: 'completed',
  warning: 'warning',
  error: 'failed',
  failed: 'failed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  unavailable: 'unavailable',
  offline: 'offline',
});

export function statusIconName(status) {
  return statusMap[String(status || '').trim().toLowerCase()] || 'queued';
}

export default function StatusIcon({ status, size = 15, label, className = '' }) {
  return (
    <Icon
      name={statusIconName(status)}
      size={size}
      label={label}
      className={`status-icon status-icon-${statusIconName(status)} ${className}`.trim()}
    />
  );
}

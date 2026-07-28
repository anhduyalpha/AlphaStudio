import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  StatusBadge,
} from '../components/index.jsx';

export function optimisticallyRemoveActivity(rows, id) {
  const index = rows.findIndex((row) => String(row.id) === String(id));
  if (index < 0) return { rows, rollback: null };
  return {
    rows: rows.filter((row) => String(row.id) !== String(id)),
    rollback: { row: rows[index], index },
  };
}

export function rollbackActivityRemoval(rows, rollback) {
  if (!rollback?.row || rows.some((row) => String(row.id) === String(rollback.row.id))) {
    return rows;
  }
  const next = [...rows];
  next.splice(Math.min(Math.max(rollback.index, 0), next.length), 0, rollback.row);
  return next;
}

export function formatActivityTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || 'Unknown time');
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function activityTone(status) {
  if (status === 'completed' || status === 'success') return 'success';
  if (status === 'failed' || status === 'error') return 'danger';
  if (status === 'queued') return 'warning';
  if (status === 'running') return 'live';
  return 'neutral';
}

function activityIcon(tool) {
  if (tool === 'pdf') return 'pdf';
  if (tool === 'qr') return 'qr';
  if (tool === 'image') return 'image';
  if (tool === 'text') return 'text-ocr';
  if (tool === 'security') return 'security';
  if (tool === 'archive') return 'archive';
  if (tool === 'audio') return 'audio';
  if (tool === 'video' || tool === 'media') return 'media';
  return 'activity';
}

function ActivityRow({ row, disabled, deleting, onDelete }) {
  const label = row.detail || row.action || row.id;
  return (
    <li className="activity-row">
      <span className="activity-row__marker"><Icon name={activityIcon(row.tool)} /></span>
      <div className="activity-row__content">
        <div className="activity-row__title">
          <strong>{row.action || 'Workspace action'}</strong>
          <StatusBadge tone={activityTone(row.status)}>{row.status || 'recorded'}</StatusBadge>
        </div>
        <p>{row.detail || `${row.tool || 'AlphaStudio'} activity`}</p>
        <span>
          <time dateTime={row.createdAt}>{formatActivityTime(row.createdAt)}</time>
          {row.tool ? ` · ${row.tool}` : ''}
          {row.jobId ? ` · job ${String(row.jobId).slice(0, 8)}` : ''}
        </span>
      </div>
      <Button
        variant="ghost"
        size="sm"
        icon="trash"
        busy={deleting}
        disabled={disabled}
        aria-label={`Delete history entry ${label}`}
        onClick={() => onDelete(row)}
      >
        {deleting ? 'Deleting' : 'Delete'}
      </Button>
    </li>
  );
}

export default function Activity() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [clearing, setClearing] = useState(false);
  const mountedRef = useRef(true);

  const loadActivity = useCallback(async ({ announce = false } = {}) => {
    setLoading(true);
    setError('');
    try {
      const payload = await api.getActivity(100);
      if (!mountedRef.current) return;
      setRows(Array.isArray(payload?.activity) ? payload.activity : []);
      if (announce) setNotice('Activity refreshed.');
    } catch (loadError) {
      if (mountedRef.current) {
        setError(loadError?.message || 'Could not load activity history.');
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadActivity();
    return () => {
      mountedRef.current = false;
    };
  }, [loadActivity]);

  const summary = useMemo(() => ({
    completed: rows.filter((row) => row.status === 'completed').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    linked: rows.filter((row) => row.jobId).length,
  }), [rows]);

  const deleteRow = useCallback(async (row) => {
    if (!row?.id || deletingId || clearing) return;
    const label = row.detail || row.action || String(row.id).slice(0, 8);
    const confirmed = window.confirm(
      row.jobId
        ? `Delete “${label}” and its generated output when safe? Source uploads are kept.`
        : `Delete “${label}” from activity history?`,
    );
    if (!confirmed) return;

    const removal = optimisticallyRemoveActivity(rows, row.id);
    if (!removal.rollback) return;
    setRows(removal.rows);
    setDeletingId(String(row.id));
    setError('');
    setNotice('');
    try {
      await api.deleteActivity(row.id, { withJob: true });
      if (row.jobId) {
        const payload = await api.getActivity(100);
        if (mountedRef.current) {
          setRows(Array.isArray(payload?.activity) ? payload.activity : []);
        }
      }
      if (mountedRef.current) setNotice('History entry deleted.');
    } catch (deleteError) {
      if (mountedRef.current) {
        setRows((current) => rollbackActivityRemoval(current, removal.rollback));
        setError(deleteError?.message || 'Delete failed; the history entry was restored.');
      }
    } finally {
      if (mountedRef.current) setDeletingId('');
    }
  }, [clearing, deletingId, rows]);

  const clearActivity = useCallback(async () => {
    if (clearing || deletingId || !rows.length) return;
    const confirmed = window.confirm(
      'Clear the entire activity log? Generated outputs and active jobs are kept.',
    );
    if (!confirmed) return;
    const previous = rows;
    setRows([]);
    setClearing(true);
    setError('');
    setNotice('');
    try {
      await api.clearActivity();
      if (mountedRef.current) setNotice('Activity history cleared.');
    } catch (clearError) {
      if (mountedRef.current) {
        setRows(previous);
        setError(clearError?.message || 'Clear failed; activity history was restored.');
      }
    } finally {
      if (mountedRef.current) setClearing(false);
    }
  }, [clearing, deletingId, rows]);

  return (
    <div className="activity-view">
      <section className="activity-hero" aria-labelledby="activity-title">
        <div>
          <p className="view-eyebrow">Local audit trail</p>
          <h2 id="activity-title">Result history</h2>
          <p>Review recent actions and remove history or linked outputs when they are no longer useful.</p>
        </div>
        <div className="activity-hero__actions">
          <Button
            variant="secondary"
            icon="refresh"
            disabled={loading || Boolean(deletingId) || clearing}
            onClick={() => loadActivity({ announce: true })}
          >
            Refresh
          </Button>
          <Button
            variant="ghost"
            icon="trash"
            busy={clearing}
            disabled={loading || Boolean(deletingId) || !rows.length}
            onClick={clearActivity}
          >
            Clear history
          </Button>
        </div>
      </section>

      <section className="activity-stats" aria-label="Activity summary">
        <article><span>Total records</span><strong>{rows.length}</strong></article>
        <article><span>Completed</span><strong>{summary.completed}</strong></article>
        <article><span>Failed</span><strong>{summary.failed}</strong></article>
        <article><span>Linked outputs</span><strong>{summary.linked}</strong></article>
      </section>

      {notice ? <p className="activity-notice" role="status">{notice}</p> : null}
      {error ? (
        <ErrorState
          title="Activity needs attention"
          message={error}
          actionLabel="Retry loading"
          actionDisabled={loading}
          onAction={() => loadActivity()}
        />
      ) : null}

      <section className="activity-history" aria-labelledby="activity-history-title">
        <header className="activity-history__header">
          <div>
            <p className="view-eyebrow">History</p>
            <h2 id="activity-history-title">Recent actions</h2>
          </div>
          <StatusBadge tone={rows.length ? 'live' : 'neutral'}>
            {rows.length} {rows.length === 1 ? 'record' : 'records'}
          </StatusBadge>
        </header>

        {loading ? (
          <Skeleton variant="row" lines={7} label="Loading activity history" />
        ) : rows.length ? (
          <ol className="activity-list" aria-label="Activity history">
            {rows.map((row) => (
              <ActivityRow
                key={row.id}
                row={row}
                disabled={Boolean(deletingId) || clearing}
                deleting={deletingId === String(row.id)}
                onDelete={deleteRow}
              />
            ))}
          </ol>
        ) : (
          <EmptyState
            visual={<Icon name="activity" />}
            title="No activity yet"
            description="Run a conversion, PDF, media, text, security, or utility job to populate this history."
            action={<Button variant="secondary" onClick={() => { window.location.hash = '/convert'; }}>Open Convert</Button>}
          />
        )}
      </section>
    </div>
  );
}

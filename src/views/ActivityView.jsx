import React, { useCallback, useEffect, useRef, useState } from 'react';
import Icon from '../components/Icon';
import { SecondaryButton, StatusBadge } from '../components/Common';
import { WorkspaceHeader } from '../components/Workbench';
import { api } from '../api/client';

export default function ActivityView({ notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState(null);
  const [clearing, setClearing] = useState(false);
  const inFlightDelete = useRef(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getActivity(100);
      setRows(data.activity || []);
    } catch (err) {
      notify?.(err.message || 'Failed to load activity');
    } finally {
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const clear = async () => {
    if (clearing) return;
    const ok = window.confirm(
      'Clear the entire activity log? This removes history entries only and does not delete job output files. Active jobs are unaffected.',
    );
    if (!ok) return;
    setClearing(true);
    try {
      await api.clearActivity();
      setRows([]);
      notify('Activity history cleared');
    } catch (err) {
      notify(err.message || 'Clear failed');
    } finally {
      setClearing(false);
    }
  };

  const deleteRow = async (row) => {
    if (!row?.id || deletingId || inFlightDelete.current.has(row.id)) return;
    const label = row.detail || row.action || row.id.slice(0, 8);
    const hasJob = Boolean(row.jobId);
    const ok = window.confirm(
      hasJob
        ? `Delete history entry “${label}” and its generated output file (if any)? Source uploads used by other jobs are kept. Active jobs cannot be deleted.`
        : `Delete history entry “${label}”?`,
    );
    if (!ok) return;

    inFlightDelete.current.add(row.id);
    setDeletingId(row.id);
    // Optimistic remove — roll back on failure
    const prev = rows;
    setRows((list) => list.filter((r) => r.id !== row.id));
    try {
      await api.deleteActivity(row.id, { withJob: true });
      notify?.('History entry deleted');
      // If job delete removed multiple activity rows, refresh for consistency
      if (hasJob) await load();
    } catch (err) {
      setRows(prev);
      notify?.(err.message || 'Delete failed');
    } finally {
      inFlightDelete.current.delete(row.id);
      setDeletingId(null);
    }
  };

  return (
    <div className="view-stack">
      <WorkspaceHeader
        meta="Manage / Activity"
        title="Result history"
        description="Persistent activity log backed by SQLite. Delete removes a history entry and its job output when safe."
        actions={
          <>
            <SecondaryButton icon="refresh" onClick={load} disabled={loading || Boolean(deletingId)}>
              Refresh
            </SecondaryButton>
            <SecondaryButton icon="trash" onClick={clear} disabled={clearing || Boolean(deletingId) || !rows.length}>
              {clearing ? 'Clearing…' : 'Clear history'}
            </SecondaryButton>
          </>
        }
      />
      <section className="activity-layout result-history-manager" data-testid="result-history-manager">
        <article className="surface-card content-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">History</p>
              <h3>Recent actions</h3>
            </div>
            <StatusBadge tone="cyan">{rows.length} records</StatusBadge>
          </div>
          <div className="activity-timeline">
            {loading ? <p>Loading…</p> : null}
            {!loading && rows.length === 0 ? <p>No activity yet. Run a tool to populate this list.</p> : null}
            {rows.map((row) => (
              <div className="timeline-row" key={row.id}>
                <div className="timeline-marker">
                  <Icon name={iconFor(row.tool)} size={17} />
                </div>
                <div className="timeline-content">
                  <span>{row.tool}</span>
                  <strong>{row.action}</strong>
                  <small>
                    {formatTime(row.createdAt)}
                    {row.detail ? ` · ${row.detail}` : ''}
                    {row.jobId ? ` · job ${String(row.jobId).slice(0, 8)}` : ''}
                  </small>
                </div>
                <StatusBadge tone={toneFor(row.status)}>{row.status}</StatusBadge>
                <SecondaryButton
                  icon="trash"
                  disabled={deletingId === row.id || Boolean(deletingId)}
                  onClick={() => deleteRow(row)}
                  aria-label={`Delete history entry ${row.detail || row.action || row.id}`}
                >
                  {deletingId === row.id ? 'Deleting…' : 'Delete'}
                </SecondaryButton>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}

function iconFor(tool) {
  if (tool === 'pdf') return 'file';
  if (tool === 'qr') return 'qr';
  if (tool === 'image') return 'image';
  if (tool === 'text') return 'code';
  return 'swap';
}

function toneFor(status) {
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'neutral';
  if (status === 'cancelled') return 'neutral';
  if (status === 'queued' || status === 'running') return 'cyan';
  return 'neutral';
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

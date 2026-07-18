import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon';
import { PageIntro, SecondaryButton, StatusBadge } from '../components/Common';
import { api } from '../api/client';

export default function ActivityView({ notify }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

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
    try {
      await api.clearActivity();
      setRows([]);
      notify('Activity history cleared');
    } catch (err) {
      notify(err.message || 'Clear failed');
    }
  };

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Manage / Activity"
        title="Review your recent activity."
        description="Persistent activity log backed by SQLite — survives restarts."
        actions={
          <>
            <SecondaryButton icon="refresh" onClick={load}>Refresh</SecondaryButton>
            <SecondaryButton icon="trash" onClick={clear}>Clear history</SecondaryButton>
          </>
        }
      />
      <section className="activity-layout">
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
                  <small>{formatTime(row.createdAt)}{row.detail ? ` · ${row.detail}` : ''}</small>
                </div>
                <StatusBadge tone={toneFor(row.status)}>{row.status}</StatusBadge>
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

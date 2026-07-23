import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, StatusBadge, Panel } from '../components/Common';
import { WorkspaceHeader, Skeleton } from '../components/Workbench';
import { quickActions, toolCards } from '../data/tools';
import { api } from '../api/client';

const ACTIVE = new Set(['queued', 'running', 'converting', 'uploading', 'processing', 'inspecting']);
const RESUMABLE = new Set(['failed', 'cancelled', 'queued', 'running', 'converting', 'processing']);

function toneForStatus(status) {
  if (status === 'completed') return 'green';
  if (status === 'failed') return 'danger';
  if (status === 'cancelled') return 'neutral';
  return 'cyan';
}

export default function DashboardView({ onNavigate, notify }) {
  const [stats, setStats] = useState({ totalJobs: 0, completedJobs: 0, failedJobs: 0, uploads: 0 });
  const [jobs, setJobs] = useState([]);
  const [health, setHealth] = useState(null);
  const [healthChecked, setHealthChecked] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setHealthChecked(false);
    setLoading(true);
    try {
      const [s, j, h] = await Promise.all([
        api.stats(),
        api.listJobs(12),
        api.health().catch(() => null),
      ]);
      setStats(s);
      setJobs(j.jobs || []);
      setHealth(h);
    } catch (err) {
      setHealth(null);
      notify?.(err.message || 'API offline — start the server with npm run dev:server');
    } finally {
      setHealthChecked(true);
      setLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  const activeJobs = useMemo(
    () => jobs.filter((job) => ACTIVE.has(String(job.status || '').toLowerCase())),
    [jobs],
  );
  const resumeJobs = useMemo(
    () => jobs.filter((job) => RESUMABLE.has(String(job.status || '').toLowerCase())).slice(0, 4),
    [jobs],
  );
  const recentJobs = useMemo(() => jobs.slice(0, 6), [jobs]);
  const frequentTools = useMemo(() => toolCards.slice(0, 8), []);
  const apiOnline = Boolean(health?.ok);

  return (
    <div className="view-stack command-center" data-testid="command-center">
      <WorkspaceHeader
        meta="Command center"
        title="Operations"
        description="Resume unfinished work, monitor active jobs, and launch tools against the local API."
        status={(
          <StatusBadge
            tone={apiOnline ? 'cyan' : healthChecked ? 'danger' : 'neutral'}
            live={!healthChecked}
            status={apiOnline ? 'completed' : healthChecked ? 'offline' : 'inspecting'}
          >
            {apiOnline ? 'API online' : healthChecked ? 'API offline' : 'Connecting…'}
          </StatusBadge>
        )}
        actions={(
          <>
            <SecondaryButton icon="activity" onClick={() => onNavigate('activity')}>Activity</SecondaryButton>
            <PrimaryButton icon="plus" onClick={() => onNavigate('converter')}>New conversion</PrimaryButton>
          </>
        )}
      />

      <section className="command-strip" aria-label="System and resume">
        <div className="command-strip-main">
          <div className="job-row-main">
            <strong>{apiOnline ? 'Local API connected' : healthChecked ? 'Local API unreachable' : 'Checking API…'}</strong>
            <span>
              {stats.totalJobs} jobs · {stats.completedJobs} completed · {stats.failedJobs} failed · {stats.uploads} uploads
            </span>
          </div>
        </div>
        <div className="hero-button-row">
          <SecondaryButton size="sm" icon="refresh" onClick={load}>Refresh</SecondaryButton>
          <SecondaryButton size="sm" onClick={() => onNavigate('settings')}>Settings</SecondaryButton>
          <PrimaryButton size="sm" onClick={() => onNavigate('converter')}>Convert files</PrimaryButton>
        </div>
      </section>

      {!apiOnline && healthChecked ? (
        <EmptyState
          type="offline"
          live
          title="API offline"
          description="Start the backend with npm run dev (or npm run dev:server) to process files and load live job data."
          action={<PrimaryButton onClick={load}>Retry connection</PrimaryButton>}
        />
      ) : null}

      <div className="command-ops-grid">
        <Panel title="Needs attention" className="command-panel-primary" actions={
          <button className="text-button" type="button" onClick={() => onNavigate('activity')}>
            Open activity <Icon name="arrow" size={16} />
          </button>
        }>
          {loading ? <Skeleton lines={4} /> : null}
          {!loading && resumeJobs.length === 0 ? (
            <EmptyState
              type="noResults"
              compact
              title="Nothing to resume"
              description="Failed, cancelled, or in-flight jobs will appear here for quick recovery."
            />
          ) : null}
          {!loading && resumeJobs.length > 0 ? (
            <div className="job-resume-list">
              {resumeJobs.map((job) => (
                <div className="job-row" key={job.id}>
                  <div className="job-row-main">
                    <strong>{job.outputName || job.type || job.id.slice(0, 8)}</strong>
                    <span>{job.type} · {job.status}</span>
                  </div>
                  <StatusBadge status={job.status} tone={toneForStatus(job.status)}>{job.status}</StatusBadge>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>

        <Panel title="Active now" className="command-panel-side">
          {loading ? <Skeleton lines={3} /> : null}
          {!loading && activeJobs.length === 0 ? (
            <p className="workspace-description" style={{ margin: 0 }}>
              No jobs running. Start a conversion or PDF operation to see live progress here.
            </p>
          ) : null}
          {!loading && activeJobs.length > 0 ? (
            <div className="job-resume-list">
              {activeJobs.map((job) => (
                <div className="job-row" key={job.id}>
                  <div className="job-row-main">
                    <strong>{job.outputName || job.id.slice(0, 8)}</strong>
                    <span>{job.type}</span>
                  </div>
                  <StatusBadge status={job.status} tone="cyan" live>{job.status}</StatusBadge>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      </div>

      <Panel
        title="Quick launch"
        actions={<StatusBadge tone="cyan">{quickActions.length} shortcuts</StatusBadge>}
      >
        <div className="command-launch-grid" role="list">
          {quickActions.map((action) => (
            <button
              type="button"
              className="command-launch-tile liquid-press"
              key={action.label}
              role="listitem"
              onClick={() => onNavigate(action.route)}
            >
              <Icon name={action.icon} size={20} />
              <strong>{action.label}</strong>
              <small>Open workspace</small>
            </button>
          ))}
        </div>
      </Panel>

      <div className="command-ops-grid">
        <Panel title="Tools" actions={
          <button className="text-button" type="button" onClick={() => onNavigate('converter')}>
            All tools <Icon name="arrow" size={16} />
          </button>
        }>
          <div className="command-launch-grid">
            {frequentTools.map((tool) => (
              <button
                type="button"
                className={`command-launch-tile liquid-press color-${tool.color}`}
                key={tool.id}
                onClick={() => onNavigate(tool.id)}
              >
                <Icon name={tool.icon} size={20} />
                <strong>{tool.name}</strong>
                <small>{tool.badge}</small>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="Recent results" actions={
          <SecondaryButton size="sm" onClick={load}>Refresh</SecondaryButton>
        }>
          {loading ? <Skeleton lines={5} /> : null}
          {!loading && recentJobs.length === 0 ? (
            <EmptyState
              type="noResults"
              compact
              title="No recent jobs"
              description="Completed work will list here with status and timestamps."
            />
          ) : null}
          {!loading && recentJobs.length > 0 ? (
            <div className="job-recent-list">
              {recentJobs.map((job) => (
                <div className="job-row" key={job.id}>
                  <div className="job-row-main">
                    <strong>{job.outputName || job.id.slice(0, 8)}</strong>
                    <span>
                      {job.type}
                      {job.createdAt ? ` · ${new Date(job.createdAt).toLocaleString()}` : ''}
                    </span>
                  </div>
                  <StatusBadge status={job.status} tone={toneForStatus(job.status)}>{job.status}</StatusBadge>
                </div>
              ))}
            </div>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

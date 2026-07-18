import React, { useCallback, useEffect, useState } from 'react';
import Icon from '../components/Icon';
import AgentFanOut from '../components/AgentFanOut';
import EmptyState from '../components/EmptyState';
import { PageIntro, PrimaryButton, SecondaryButton, StatusBadge } from '../components/Common';
import { quickActions, toolCards } from '../data/tools';
import { api } from '../api/client';

export default function DashboardView({ onNavigate, notify }) {
  const [stats, setStats] = useState({ totalJobs: 0, completedJobs: 0, failedJobs: 0, uploads: 0 });
  const [jobs, setJobs] = useState([]);
  const [health, setHealth] = useState(null);
  const [healthChecked, setHealthChecked] = useState(false);

  const load = useCallback(async () => {
    setHealthChecked(false);
    try {
      const [s, j, h] = await Promise.all([
        api.stats(),
        api.listJobs(8),
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
    }
  }, [notify]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="AlphaStudio / Overview"
        title="Your private utility workspace."
        description="Local-first file conversion, document processing, QR utilities, media tools, and developer helpers — powered by a Node API on your machine."
        actions={
          <>
            <SecondaryButton icon="activity" onClick={() => onNavigate('activity')}>View activity</SecondaryButton>
            <PrimaryButton icon="plus" onClick={() => onNavigate('converter')}>New conversion</PrimaryButton>
          </>
        }
      />

      <section className="dashboard-hero surface-card">
        <div className="dashboard-hero-copy">
          <StatusBadge
            tone={health?.ok ? 'cyan' : healthChecked ? 'danger' : 'neutral'}
            live={!healthChecked}
            status={health?.ok ? 'completed' : healthChecked ? 'offline' : 'inspecting'}
          >
            {health?.ok ? 'API online' : healthChecked ? 'API offline' : 'Connecting…'}
          </StatusBadge>
          <h3>One polished interface for the small tools you use every day.</h3>
          <p>
            Open any workspace from the sidebar, configure controls, and process files through the local AlphaStudio backend with real progress and downloads.
          </p>
          <div className="hero-button-row">
            <PrimaryButton onClick={() => onNavigate('converter')}>Launch converter</PrimaryButton>
            <SecondaryButton onClick={() => onNavigate('pdf')}>Open PDF Studio</SecondaryButton>
          </div>
        </div>
        <div className="hero-visual">
          {healthChecked && !health?.ok ? (
            <EmptyState type="offline" compact live />
          ) : (
            <AgentFanOut />
          )}
        </div>
      </section>

      <section className="stat-grid">
        {[
          [String(stats.totalJobs), 'Jobs run', 'dashboard', 'purple'],
          [String(stats.completedJobs), 'Completed', 'layers', 'cyan'],
          [String(stats.uploads), 'Files uploaded', 'upload', 'blue'],
          [String(stats.failedJobs), 'Failed jobs', 'lock', 'green'],
        ].map(([value, label, icon, tone]) => (
          <article className="stat-card surface-card" key={label}>
            <div className={`stat-icon icon-${tone}`}><Icon name={icon} /></div>
            <strong>{value}</strong>
            <span>{label}</span>
          </article>
        ))}
      </section>

      <section className="surface-card content-card quick-actions-section">
        <div className="card-heading">
          <div><p className="eyebrow">Quick launch</p><h3>Start with a common action</h3></div>
          <StatusBadge tone="cyan">{quickActions.length} shortcuts</StatusBadge>
        </div>
        <div className="dashboard-quick-grid">
          {quickActions.map((action) => (
            <button type="button" key={action.label} onClick={() => onNavigate(action.route)}>
              <span><Icon name={action.icon} size={19} /></span>
              <strong>{action.label}</strong>
              <Icon name="arrow" size={16} />
            </button>
          ))}
        </div>
      </section>

      <section className="content-grid two-one-grid">
        <article className="surface-card content-card">
          <div className="card-heading">
            <div>
              <p className="eyebrow">Toolbox</p>
              <h3>Choose a workspace</h3>
            </div>
            <button className="text-button" type="button" onClick={() => onNavigate('converter')}>
              Open first tool <Icon name="arrow" size={16} />
            </button>
          </div>
          <div className="tool-launch-grid">
            {toolCards.map((tool) => (
              <button className={`launch-card color-${tool.color}`} key={tool.id} type="button" onClick={() => onNavigate(tool.id)}>
                <img className="launch-art" src={tool.art} alt="" width="640" height="400" loading="lazy" />
                <div className="launch-icon"><Icon name={tool.icon} /></div>
                <div>
                  <strong>{tool.name}</strong>
                  <p>{tool.description}</p>
                </div>
                <StatusBadge>{tool.badge}</StatusBadge>
              </button>
            ))}
          </div>
        </article>

        <aside className="surface-card content-card privacy-card">
          <div className="privacy-orb"><Icon name="lock" size={30} /></div>
          <p className="eyebrow">Privacy model</p>
          <h3>Designed for personal localhost use.</h3>
          <p>
            Processing runs on a local Node.js API. Files stay on your machine under a sandboxed data directory — no cloud upload required.
          </p>
          <div className="privacy-list">
            <span><Icon name="check" size={16} /> Local API only</span>
            <span><Icon name="check" size={16} /> No cloud upload</span>
            <span><Icon name="check" size={16} /> Capability-aware tools</span>
          </div>
        </aside>
      </section>

      <section className="surface-card content-card">
        <div className="card-heading">
          <div>
            <p className="eyebrow">Recent jobs</p>
            <h3>Latest processing activity</h3>
          </div>
          <SecondaryButton onClick={load}>Refresh</SecondaryButton>
        </div>
        <div className="data-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Job</th>
                <th>Operation</th>
                <th>Status</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      type="noResults"
                      compact
                      title="No jobs yet"
                      description="Run a conversion to populate recent processing activity."
                    />
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id}>
                    <td>
                      <div className="file-cell">
                        <span className="file-type-icon"><Icon name="file" size={17} /></span>
                        <strong>{job.outputName || job.id.slice(0, 8)}</strong>
                      </div>
                    </td>
                    <td>{job.type}</td>
                    <td>
                      <StatusBadge status={job.status} tone={job.status === 'completed' ? 'green' : job.status === 'failed' ? 'danger' : 'cyan'}>
                        {job.status}
                      </StatusBadge>
                    </td>
                    <td>{job.createdAt ? new Date(job.createdAt).toLocaleString() : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

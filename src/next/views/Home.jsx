import React, { useCallback, useMemo, useState } from 'react';
import { api } from '../../api/client.js';
import { hubRegistry } from '../../hubs/index';
import { hydrate, selectActiveJobs } from '../../protocol/store.js';
import { recoverUploadSessions } from '../../protocol/uploads.js';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Icon,
  ResumeStrip,
  Skeleton,
  StatusBadge,
} from '../components/index.jsx';
import useStore from '../hooks/useStore.js';

const selectSnapshot = (snapshot) => snapshot;
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled']);

const TYPE_DESTINATIONS = Object.freeze({
  converter: { hubId: 'convert', modeId: 'convert' },
  pdf: { hubId: 'pdf', modeId: 'operations' },
  video: { hubId: 'media', modeId: 'video' },
  audio: { hubId: 'media', modeId: 'audio' },
  text: { hubId: 'text', modeId: 'text' },
  security: { hubId: 'security', modeId: 'security' },
  archive: { hubId: 'security', modeId: 'archive' },
  qr: { hubId: 'utilities', modeId: 'qr' },
  image: { hubId: 'media', modeId: 'image' },
});

function titleCase(value) {
  return String(value || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function homeJobDestination(job) {
  const type = String(job?.type || '');
  const markedMode = String(job?.options?._mode || '');
  if (type === 'image' && markedMode === 'color') {
    return { hubId: 'utilities', modeId: 'color' };
  }
  if (type === 'text' && ['text', 'editor', 'ocr', 'dev'].includes(markedMode)) {
    return { hubId: 'text', modeId: markedMode };
  }
  const destination = TYPE_DESTINATIONS[type] || TYPE_DESTINATIONS.converter;
  return { ...destination };
}

export function homeUploadDestination(session) {
  const mime = String(session?.mime || '').toLowerCase();
  const name = String(session?.originalName || '').toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) {
    return { hubId: 'pdf', modeId: 'operations' };
  }
  if (mime.startsWith('video/')) return { hubId: 'media', modeId: 'video' };
  if (mime.startsWith('audio/')) return { hubId: 'media', modeId: 'audio' };
  if (mime.startsWith('image/')) return { hubId: 'media', modeId: 'image' };
  if (/\.(zip|7z|tar|gz|tgz)$/i.test(name)) {
    return { hubId: 'security', modeId: 'archive' };
  }
  return { hubId: 'convert', modeId: 'convert' };
}

export function homeStats(snapshot) {
  const storageBytes = [
    ...(snapshot?.files || []),
    ...(snapshot?.outputs || []),
  ].reduce((total, item) => {
    const size = Number(item?.size);
    return total + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
  const jobs = snapshot?.jobs || [];
  return {
    jobsRun: jobs.length,
    storageBytes,
    activeJobs: selectActiveJobs(snapshot).length,
    completedJobs: jobs.filter((job) => job.status === 'completed').length,
  };
}

export function formatStorage(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const scaled = value / (1024 ** index);
  return `${scaled >= 10 || index === 0 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
}

export function formatRelativeTime(value, now = Date.now()) {
  const timestamp = Date.parse(String(value || ''));
  if (!Number.isFinite(timestamp)) return 'Recently';
  const seconds = Math.round((timestamp - now) / 1000);
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function jobLabel(job) {
  const operation = job?.options?.operation;
  return job?.outputName
    || job?.label
    || (operation ? `${titleCase(operation)} ${titleCase(job.type)}` : `${titleCase(job.type)} job`);
}

function resumeJob(job) {
  return {
    ...job,
    ...homeJobDestination(job),
    label: jobLabel(job),
  };
}

function resumeSession(session) {
  return {
    ...session,
    ...homeUploadDestination(session),
  };
}

function toneForStatus(status) {
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'danger';
  if (status === 'running') return 'live';
  if (status === 'queued') return 'warning';
  return 'neutral';
}

function HomeJobRow({ job }) {
  const destination = homeJobDestination(job);
  const href = `#/${destination.hubId}?mode=${destination.modeId}`;
  return (
    <li className="home-job-row">
      <a href={href} className="home-job-row__link">
        <span className="home-job-row__icon">
          <Icon name={job.status === 'completed' ? 'check' : 'refresh'} />
        </span>
        <span className="home-job-row__copy">
          <strong>{jobLabel(job)}</strong>
          <span>
            {titleCase(destination.hubId)}
            {' · '}
            <time dateTime={job.updatedAt || job.createdAt}>
              {formatRelativeTime(job.updatedAt || job.createdAt)}
            </time>
          </span>
        </span>
        <StatusBadge tone={toneForStatus(job.status)}>{titleCase(job.status)}</StatusBadge>
        <Icon name="arrow" />
      </a>
    </li>
  );
}

export default function Home() {
  const snapshot = useStore(selectSnapshot);
  const [discardingId, setDiscardingId] = useState('');
  const [resumeError, setResumeError] = useState('');
  const stats = useMemo(() => homeStats(snapshot), [snapshot]);
  const activeJobs = useMemo(
    () => selectActiveJobs(snapshot).map(resumeJob),
    [snapshot],
  );
  const uploadSessions = useMemo(
    () => snapshot.uploadSessions.map(resumeSession),
    [snapshot.uploadSessions],
  );
  const recentJobs = useMemo(
    () => snapshot.jobs
      .filter((job) => TERMINAL_STATUSES.has(job.status))
      .sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt))
      .slice(0, 5),
    [snapshot.jobs],
  );

  const resumeUpload = useCallback((session) => {
    const destination = homeUploadDestination(session);
    window.location.hash = `/${destination.hubId}?mode=${encodeURIComponent(destination.modeId)}`;
  }, []);

  const discardUpload = useCallback(async (session) => {
    if (!snapshot.workspaceId || discardingId) return;
    setDiscardingId(session.id);
    setResumeError('');
    try {
      await api.cancelUploadSession(session.id);
      await recoverUploadSessions(snapshot.workspaceId);
    } catch (error) {
      setResumeError(error?.message || 'Could not discard the resumable upload.');
    } finally {
      setDiscardingId('');
    }
  }, [discardingId, snapshot.workspaceId]);

  const refreshUploads = useCallback(async () => {
    if (!snapshot.workspaceId) return;
    setResumeError('');
    try {
      await recoverUploadSessions(snapshot.workspaceId);
    } catch (error) {
      setResumeError(error?.message || 'Could not refresh resumable uploads.');
    }
  }, [snapshot.workspaceId]);

  if (snapshot.status === 'idle' || snapshot.status === 'hydrating') {
    return (
      <div className="home-view" aria-label="Loading Home">
        <Skeleton variant="row" lines={7} label="Loading Home" />
      </div>
    );
  }

  if (snapshot.error) {
    return (
      <div className="home-view">
        <ErrorState
          title="Home is waiting for the workspace"
          message={snapshot.error.message}
          actionLabel="Retry workspace"
          onAction={() => hydrate({ route: 'home' })}
        />
      </div>
    );
  }

  return (
    <div className="home-view">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <p className="view-eyebrow">Private command center</p>
          <h2 id="home-title">Keep every local workflow moving.</h2>
          <p>
            Resume interrupted work, track live processing, or launch a focused studio.
            Your files never leave this workspace.
          </p>
        </div>
        <a className="home-hero__action button button--primary button--md" href="#/convert">
          <span className="button__content">
            <span className="button__icon"><Icon name="plus" /></span>
            Start a conversion
          </span>
        </a>
      </section>

      <section className="home-stats" aria-label="Workspace statistics">
        <article>
          <Icon name="activity" />
          <span>Jobs run</span>
          <strong>{stats.jobsRun}</strong>
        </article>
        <article>
          <Icon name="layers" />
          <span>Storage used</span>
          <strong>{formatStorage(stats.storageBytes)}</strong>
        </article>
        <article>
          <Icon name="refresh" />
          <span>Active now</span>
          <strong>{stats.activeJobs}</strong>
        </article>
        <article>
          <Icon name="check" />
          <span>Completed</span>
          <strong>{stats.completedJobs}</strong>
        </article>
      </section>

      <section className="home-continuity" aria-labelledby="home-continuity-title">
        <div className="home-section-heading">
          <div>
            <p className="view-eyebrow">Continuity</p>
            <h2 id="home-continuity-title">Resume work</h2>
          </div>
          <StatusBadge tone={activeJobs.length || uploadSessions.length ? 'live' : 'neutral'}>
            {activeJobs.length + uploadSessions.length} waiting
          </StatusBadge>
        </div>
        {resumeError ? (
          <ErrorState
            title="The upload is still available"
            message={resumeError}
            actionLabel="Refresh uploads"
            onAction={refreshUploads}
          />
        ) : null}
        <ResumeStrip
          uploadSessions={uploadSessions}
          jobs={activeJobs}
          onResume={resumeUpload}
          onDiscard={discardUpload}
          aria-busy={Boolean(discardingId)}
        />
      </section>

      <div className="home-boards">
        <Card
          className="home-board"
          title="Active jobs"
          subtitle="Live from the shared workspace"
          actions={activeJobs.length ? <StatusBadge tone="live">{activeJobs.length} active</StatusBadge> : null}
        >
          {activeJobs.length ? (
            <ul className="home-job-list">
              {activeJobs.slice(0, 4).map((job) => <HomeJobRow key={job.id} job={job} />)}
            </ul>
          ) : (
            <EmptyState
              variant="compact"
              visual={<Icon name="check" />}
              title="No active jobs"
              description="The workspace is caught up and ready for something new."
              action={<Button size="sm" variant="ghost" onClick={() => { window.location.hash = '/convert'; }}>Open Convert</Button>}
            />
          )}
        </Card>

        <Card
          className="home-board"
          title="Recent jobs"
          subtitle="Latest completed attempts"
          actions={<a className="home-inline-link" href="#/activity">View activity <Icon name="arrow" /></a>}
        >
          {recentJobs.length ? (
            <ul className="home-job-list">
              {recentJobs.map((job) => <HomeJobRow key={job.id} job={job} />)}
            </ul>
          ) : (
            <EmptyState
              variant="compact"
              visual={<Icon name="activity" />}
              title="No recent jobs"
              description="Completed, failed, and cancelled attempts will appear here."
              action={<Button size="sm" variant="ghost" onClick={() => { window.location.hash = '/convert'; }}>Create first job</Button>}
            />
          )}
        </Card>
      </div>

      <section className="home-launchers" aria-labelledby="home-launchers-title">
        <div className="home-section-heading">
          <div>
            <p className="view-eyebrow">Studios</p>
            <h2 id="home-launchers-title">Choose a workspace</h2>
          </div>
          <span>Six focused hubs, one local source of truth.</span>
        </div>
        <div className="home-launchers__grid">
          {hubRegistry.map((hub) => (
            <a className="home-launcher" href={`#/${hub.id}`} key={hub.id}>
              <span className="home-launcher__icon"><Icon name={hub.icon} size={24} /></span>
              <span>
                <strong>{hub.name}</strong>
                <small>{hub.modes.length} {hub.modes.length === 1 ? 'workflow' : 'workflows'}</small>
              </span>
              <Icon name="arrow" />
            </a>
          ))}
        </div>
      </section>
    </div>
  );
}

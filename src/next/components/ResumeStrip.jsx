import React from 'react';
import Button from './Button';
import Icon from './Icon';
import ProgressBar from './ProgressBar';
import { formatBytes } from './FileRow';

function entryHref(entry) {
  if (entry.href) return entry.href;
  if (!entry.hubId) {
    throw new Error('ResumeStrip entries require href or hubId so they link to the owning workflow.');
  }
  const mode = entry.modeId ? `?mode=${encodeURIComponent(entry.modeId)}` : '';
  return `#/${entry.hubId}${mode}`;
}

function uploadProgress(session) {
  const size = Number(session.size);
  if (!Number.isFinite(size) || size <= 0) return 0;
  return (Number(session.receivedBytes) / size) * 100;
}

export default function ResumeStrip({
  variant = 'full',
  uploadSessions = [],
  jobs = [],
  onResume,
  onDiscard,
  className = '',
  ...props
}) {
  const safeVariant = variant === 'uploads-only' ? 'uploads-only' : 'full';
  const visibleJobs = safeVariant === 'full' ? jobs : [];
  const empty = uploadSessions.length === 0 && visibleJobs.length === 0;

  return (
    <section
      {...props}
      className={[
        'resume-strip',
        `resume-strip--${safeVariant}`,
        empty ? 'resume-strip--empty' : '',
        className,
      ].filter(Boolean).join(' ')}
      aria-label={safeVariant === 'full' ? 'Resume work' : 'Resumable uploads'}
    >
      <header className="resume-strip__header">
        <span className="resume-strip__eyebrow">
          <Icon name="refresh" />
          {safeVariant === 'full' ? 'Continue where you left off' : 'Uploads ready to resume'}
        </span>
      </header>
      {empty ? (
        <p className="resume-strip__empty">Nothing to resume.</p>
      ) : (
        <div className="resume-strip__items">
          {uploadSessions.map((session) => (
            <article className="resume-strip__item" key={`upload:${session.id}`}>
              <a className="resume-strip__link" href={entryHref(session)}>
                <strong>{session.originalName || session.label}</strong>
                <span>
                  {formatBytes(session.receivedBytes)} of {formatBytes(session.size)}
                </span>
              </a>
              <ProgressBar
                value={uploadProgress(session)}
                label={`${session.originalName || session.label} upload`}
              />
              <div className="resume-strip__actions">
                <Button size="sm" variant="secondary" onClick={() => onResume?.(session)}>
                  Resume
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDiscard?.(session)}>
                  Discard
                </Button>
              </div>
            </article>
          ))}
          {visibleJobs.map((job) => (
            <article className="resume-strip__item" key={`job:${job.id}`}>
              <a className="resume-strip__link" href={entryHref(job)}>
                <strong>{job.label || job.outputName || job.type || 'Active job'}</strong>
                <span>{job.status === 'queued' ? 'Queued' : 'In progress'}</span>
              </a>
              <ProgressBar
                value={job.progress}
                label={`${job.label || job.type || 'Job'} progress`}
              />
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

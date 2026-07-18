import React, { useState } from 'react';
import { api } from '../api/client';
import { SecondaryButton, StatusBadge } from './Common';
import EmptyState from './EmptyState';

/** Shared manual-download result card. Jobs never force a browser download. */
export default function JobOutputCard({ job, notify, title = 'Converted output' }) {
  const [downloading, setDownloading] = useState(false);
  if (!job) return null;

  const completed = job.status === 'completed' && Boolean(job.downloadUrl);
  const download = async () => {
    if (!completed || downloading) return;
    setDownloading(true);
    try {
      await api.downloadJob(job.id, job.outputName || 'download');
      notify?.(`Downloaded ${job.outputName || 'output'}`);
    } catch (err) {
      notify?.(err?.message || 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <article className="surface-card content-card converted-results job-output-card" aria-live="polite">
      <div className="card-heading compact-heading">
        <div>
          <p className="eyebrow">Result</p>
          <h3>{title}</h3>
        </div>
        <StatusBadge status={job.status} tone={completed ? 'green' : job.status === 'failed' ? 'danger' : 'cyan'}>
          {job.status}
        </StatusBadge>
      </div>
      {job.status === 'failed' ? (
        <EmptyState
          type="conversionFailed"
          compact
          title={job.outputName || 'Conversion failed'}
          description={job.error || job.message || 'Review the error and retry the operation.'}
        />
      ) : (
        <div className="converted-row">
          <div className="file-info">
            <strong>{job.outputName || job.message || 'Output pending'}</strong>
            <span>{completed ? 'Ready in AlphaStudio — download when you choose.' : job.error || job.message}</span>
          </div>
          {completed ? (
            <SecondaryButton icon="download" onClick={download} disabled={downloading}>
              {downloading ? 'Downloading…' : 'Download'}
            </SecondaryButton>
          ) : null}
        </div>
      )}
    </article>
  );
}

import React, { useState } from 'react';
import { api } from '../api/client';
import { SecondaryButton, StatusBadge } from './Common';
import EmptyState from './EmptyState';
import { describeJobMeta } from '../lib/pdfJobOptions';

/** Shared manual-download result card. Jobs never force a browser download. */
export default function JobOutputCard({ job, notify, title = 'Converted output' }) {
  const [downloading, setDownloading] = useState(false);
  if (!job) return null;

  const completed = job.status === 'completed' && Boolean(job.downloadUrl);
  const extraBits = describeJobMeta(job);
  const mime = job.outputMime || job.mime || job.meta?.mime || '';
  const kindHint = mime.includes('zip')
    ? 'ZIP archive'
    : mime.includes('json')
      ? 'JSON report'
      : mime.startsWith('text/') || /\.txt$/i.test(job.outputName || '')
        ? 'Text'
        : mime.startsWith('image/')
          ? 'Image'
          : mime.includes('pdf')
            ? 'PDF'
            : null;

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
          <p className="eyebrow">Result{kindHint ? ` · ${kindHint}` : ''}</p>
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
      ) : job.status === 'cancelled' ? (
        <EmptyState
          type="conversionFailed"
          compact
          title="Cancelled"
          description={job.message || 'Job was cancelled. You can start a new operation.'}
        />
      ) : (
        <div className="converted-row">
          <div className="file-info">
            <strong>{job.outputName || job.message || 'Output pending'}</strong>
            <span>
              {completed
                ? 'Ready in AlphaStudio — download when you choose.'
                : job.error || job.message || job.status}
            </span>
            {extraBits.length ? (
              <span className="helper-note" style={{ display: 'block', marginTop: '0.25rem' }}>
                {extraBits.join(' · ')}
              </span>
            ) : null}
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

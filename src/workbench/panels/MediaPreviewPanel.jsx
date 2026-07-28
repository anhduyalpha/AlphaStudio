import React, { useEffect, useMemo, useState } from 'react';
import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  StatusBadge,
} from '../../next/components/index.jsx';
import useJobPreviewUrl from '../../hooks/useJobPreviewUrl.js';

function useObjectUrl(file) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : ''), [file]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

function seconds(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? `${numeric.toFixed(2)}s` : '—';
}

export default function MediaPreviewPanel({ state = {}, dispatch = () => {} }) {
  const {
    file = null,
    previewFile = null,
    previewStatus = 'idle',
    previewError = '',
    mode = 'video',
    operation = '',
    duration = 0,
    resultJob = null,
    disabled = false,
    visible = true,
  } = state || {};
  const [decodeError, setDecodeError] = useState('');
  const sourceUrl = useObjectUrl(previewFile);
  const resultEnabled = Boolean(
    resultJob?.status === 'completed'
    && operation !== 'inspect'
    && mode !== 'image',
  );
  const {
    url: resultUrl,
    error: resultError,
    loading: resultLoading,
  } = useJobPreviewUrl(resultJob, { enabled: resultEnabled });

  useEffect(() => {
    setDecodeError('');
  }, [sourceUrl, mode]);

  if (!visible) return null;

  const outputMode = operation === 'extract-audio' ? 'audio' : mode;
  const activeUrl = resultUrl || sourceUrl;
  const previewLabel = resultUrl ? 'Completed output preview' : 'Source preview';
  const mediaError = decodeError || resultError;
  const ready = previewStatus === 'ready' && Boolean(activeUrl);

  return (
    <section className="media-preview-panel" data-media-preview="true">
      <header className="media-preview-panel__header">
        <div>
          <p className="view-eyebrow">Preview</p>
          <h3>{file?.originalName || file?.name || 'Choose a media file'}</h3>
        </div>
        <StatusBadge tone={mediaError ? 'danger' : resultLoading ? 'live' : ready ? 'success' : 'neutral'}>
          {mediaError ? 'Undecodable' : resultLoading ? 'Loading output' : ready ? previewLabel : 'Waiting for input'}
        </StatusBadge>
      </header>

      {!file ? (
        <EmptyState
          variant="compact"
          visual={<Icon name={mode === 'image' ? 'image' : mode === 'audio' ? 'audio' : 'media'} />}
          title={`No ${mode} selected`}
          description="Select one compatible workspace file to preview it here."
        />
      ) : null}

      {file && previewStatus === 'loading' ? (
        <div className="media-preview-panel__loading">
          <Skeleton variant="row" lines={3} label={`Loading ${mode} preview`} />
        </div>
      ) : null}

      {file && previewStatus === 'error' ? (
        <ErrorState
          title="Could not load the source preview"
          message={`${previewError || 'The file could not be read.'} Backend processing remains available.`}
          actionLabel="Retry preview"
          onAction={() => dispatch({ type: 'retry-preview' })}
        />
      ) : null}

      {file && mediaError ? (
        <ErrorState
          title="This media cannot be decoded in the browser"
          message={`${mediaError}. The local processing engine may still support this container.`}
          actionLabel="Retry preview"
          onAction={() => {
            setDecodeError('');
            dispatch({ type: 'retry-preview' });
          }}
        />
      ) : null}

      {ready && !mediaError ? (
        <div className="media-preview-panel__stage">
          {outputMode === 'video' ? (
            <video
              key={activeUrl}
              controls
              preload="metadata"
              src={activeUrl}
              aria-label={previewLabel}
              onLoadedMetadata={(event) => dispatch({
                type: 'set-duration',
                value: Number(event.currentTarget.duration) || 0,
              })}
              onError={() => setDecodeError('The browser rejected the video stream')}
            />
          ) : null}
          {outputMode === 'audio' ? (
            <audio
              key={activeUrl}
              controls
              preload="metadata"
              src={activeUrl}
              aria-label={previewLabel}
              onLoadedMetadata={(event) => dispatch({
                type: 'set-duration',
                value: Number(event.currentTarget.duration) || 0,
              })}
              onError={() => setDecodeError('The browser rejected the audio stream')}
            />
          ) : null}
          {outputMode === 'image' ? (
            <img
              key={activeUrl}
              src={activeUrl}
              alt={previewLabel}
              onLoad={(event) => dispatch({
                type: 'set-dimensions',
                value: {
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                },
              })}
              onError={() => setDecodeError('The browser rejected the image')}
            />
          ) : null}
        </div>
      ) : null}

      {file ? (
        <footer className="media-preview-panel__meta">
          <span>{mode.toUpperCase()}</span>
          <span>{file.mime || previewFile?.type || 'Detected after upload'}</span>
          {mode !== 'image' ? <span>Duration {seconds(duration)}</span> : null}
          {disabled ? <span>Locked while processing</span> : null}
          {resultUrl ? (
            <Button size="sm" variant="ghost" onClick={() => dispatch({ type: 'show-source' })}>
              Source remains selected
            </Button>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
}

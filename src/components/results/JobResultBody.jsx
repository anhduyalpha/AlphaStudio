import React, { useEffect, useState } from 'react';
import { api } from '../../api/client';
import { SecondaryButton, StatusBadge } from '../Common';
import {
  classifyJsonPayload,
  classifyJobResult,
  copyText,
} from '../../lib/jobResultKind';
import useJobPreviewUrl from '../../hooks/useJobPreviewUrl';

function CopyButton({ value, notify, label = 'Copy' }) {
  return (
    <SecondaryButton
      icon="copy"
      size="sm"
      onClick={async () => {
        const ok = await copyText(value);
        notify?.(ok ? 'Copied' : 'Copy failed');
      }}
    >
      {label}
    </SecondaryButton>
  );
}

function HashTable({ data, notify }) {
  const entries = Object.entries(data.algorithms || {});
  return (
    <div className="job-result-typed job-result-hash" data-testid="job-result-hash">
      <div className="preview-info-list">
        {data.filename ? <div><span>File</span><strong>{data.filename}</strong></div> : null}
        {data.size != null ? <div><span>Size</span><strong>{data.size}</strong></div> : null}
      </div>
      <div className="hash-table" role="table" aria-label="Checksums">
        {entries.map(([algo, digest]) => (
          <div className="hash-row" role="row" key={algo}>
            <span role="cell" className="hash-algo">{algo}</span>
            <code role="cell" className="hash-digest">{digest}</code>
            <CopyButton value={digest} notify={notify} label="Copy" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CompareResult({ data }) {
  const ok = Boolean(data.match);
  return (
    <div className="job-result-typed job-result-compare" data-testid="job-result-compare">
      <StatusBadge tone={ok ? 'green' : 'danger'} status={ok ? 'completed' : 'failed'}>
        {ok ? 'Checksum match' : 'Checksum mismatch'}
      </StatusBadge>
      <div className="preview-info-list" style={{ marginTop: 12 }}>
        <div><span>Algorithm</span><strong>{data.algorithm}</strong></div>
        <div><span>Expected</span><strong className="mono-wrap">{data.expected}</strong></div>
        <div><span>Actual</span><strong className="mono-wrap">{data.actual}</strong></div>
      </div>
    </div>
  );
}

function PasswordResult({ data, notify }) {
  const [reveal, setReveal] = useState(false);
  const pw = String(data.password || '');
  return (
    <div className="job-result-typed job-result-password" data-testid="job-result-password">
      <p className="eyebrow">Generated password</p>
      <code className="password-display">{reveal ? pw : '•'.repeat(Math.min(pw.length, 24))}</code>
      <div className="hero-button-row" style={{ marginTop: 12 }}>
        <SecondaryButton size="sm" onClick={() => setReveal((v) => !v)}>
          {reveal ? 'Hide' : 'Reveal'}
        </SecondaryButton>
        <CopyButton value={pw} notify={notify} label="Copy password" />
      </div>
      <div className="preview-info-list" style={{ marginTop: 12 }}>
        <div><span>Length</span><strong>{data.length}</strong></div>
        <div><span>Symbols</span><strong>{data.symbols ? 'Yes' : 'No'}</strong></div>
      </div>
    </div>
  );
}

function SignatureResult({ data }) {
  const ok = Boolean(data.match);
  return (
    <div className="job-result-typed job-result-signature" data-testid="job-result-signature">
      <StatusBadge tone={ok ? 'green' : 'neutral'} status={ok ? 'completed' : 'failed'}>
        {ok ? 'Extension matches content' : 'Extension / magic mismatch'}
      </StatusBadge>
      <div className="preview-info-list" style={{ marginTop: 12 }}>
        <div><span>Extension</span><strong>{data.extension || '—'}</strong></div>
        <div><span>Detected</span><strong>{data.detectedMime || data.detectedExt || '—'}</strong></div>
        <div><span>Magic (hex)</span><strong className="mono-wrap">{data.magicHex || '—'}</strong></div>
      </div>
    </div>
  );
}

function MetadataResult({ data }) {
  const img = data.image && typeof data.image === 'object' ? data.image : null;
  return (
    <div className="job-result-typed job-result-metadata" data-testid="job-result-metadata">
      <div className="preview-info-list">
        <div><span>Name</span><strong>{data.name || '—'}</strong></div>
        <div><span>Size</span><strong>{data.size != null ? `${data.size} B` : '—'}</strong></div>
        <div><span>MIME</span><strong>{data.mime || '—'}</strong></div>
        {img && !img.error ? (
          <>
            <div><span>Dimensions</span><strong>{img.width}×{img.height}</strong></div>
            <div><span>Format</span><strong>{img.format || '—'}</strong></div>
            <div><span>EXIF</span><strong>{img.exif ? 'Present' : 'None'}</strong></div>
          </>
        ) : null}
        {img?.error ? <div><span>Image</span><strong>{img.error}</strong></div> : null}
      </div>
    </div>
  );
}

function MediaInspectResult({ data }) {
  const streams = Array.isArray(data.streams) ? data.streams : [];
  const fmt = data.format || {};
  return (
    <div className="job-result-typed job-result-media-inspect" data-testid="job-result-media-inspect">
      <div className="preview-info-list">
        <div><span>Format</span><strong>{fmt.format_name || data.format || '—'}</strong></div>
        <div><span>Duration</span><strong>{fmt.duration || data.duration || '—'}</strong></div>
        <div><span>Size</span><strong>{fmt.size || data.size || '—'}</strong></div>
        <div><span>Streams</span><strong>{streams.length}</strong></div>
      </div>
      {streams.length ? (
        <ul className="inspect-stream-list">
          {streams.slice(0, 24).map((s, i) => (
            <li key={i}>
              <strong>{s.codec_type || s.type || 'stream'}</strong>
              {' · '}
              {s.codec_name || s.codec || '—'}
              {s.width && s.height ? ` · ${s.width}×${s.height}` : ''}
              {s.sample_rate ? ` · ${s.sample_rate} Hz` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ArchiveListingResult({ data }) {
  const list = data.entries || data.files || data.contents || [];
  const rows = Array.isArray(list) ? list : [];
  return (
    <div className="job-result-typed job-result-archive-listing" data-testid="job-result-archive-listing">
      <p className="helper-note">{data.count != null ? data.count : rows.length} entries · format {data.format || 'auto'}</p>
      <ul className="archive-flat-list">
        {rows.slice(0, 100).map((e, i) => {
          const name = typeof e === 'string' ? e : (e.name || e.path || e.entry || `entry-${i}`);
          const size = typeof e === 'object' && e && e.size != null ? e.size : null;
          return (
            <li key={`${name}-${i}`}>
              <span>{name}</span>
              {size != null ? <small>{size} B</small> : null}
            </li>
          );
        })}
      </ul>
      {rows.length > 100 ? <p className="helper-note">Showing first 100 of {rows.length}</p> : null}
    </div>
  );
}

function JsonGeneric({ data, notify }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="job-result-typed job-result-json" data-testid="job-result-json">
      <div className="hero-button-row" style={{ marginBottom: 8 }}>
        <CopyButton value={text} notify={notify} label="Copy JSON" />
      </div>
      <pre className="code-output" style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{text}</pre>
    </div>
  );
}

function TextBody({ text, notify }) {
  return (
    <div className="job-result-typed job-result-text" data-testid="job-result-text">
      <div className="hero-button-row" style={{ marginBottom: 8 }}>
        <CopyButton value={text} notify={notify} label="Copy text" />
      </div>
      <pre className="code-output" style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{text}</pre>
    </div>
  );
}

function ImageBody({ job, notify }) {
  const { url, error, loading } = useJobPreviewUrl(job, { enabled: true });
  return (
    <div className="job-result-typed job-result-image" data-testid="job-result-image">
      {loading ? <p className="helper-note">Loading preview…</p> : null}
      {error ? <p className="helper-note">{error}</p> : null}
      {url ? (
        <img src={url} alt={job.outputName || 'Result preview'} className="job-result-image-preview" />
      ) : null}
    </div>
  );
}

function JsonBody({ job, notify }) {
  const [data, setData] = useState(null);
  const [raw, setRaw] = useState('');
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!job?.id || job.status !== 'completed') return undefined;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const text = await api.fetchJobText(job.id);
        if (cancelled) return;
        setRaw(text);
        try {
          setData(JSON.parse(text));
        } catch {
          setData(null);
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Failed to load result');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [job?.id, job?.status]);

  if (loading) return <p className="helper-note">Loading result…</p>;
  if (err) return <p className="helper-note">{err}</p>;
  if (!data) return <TextBody text={raw} notify={notify} />;

  const kind = classifyJsonPayload(data, job);
  if (kind === 'hash') return <HashTable data={data} notify={notify} />;
  if (kind === 'checksum-compare') return <CompareResult data={data} />;
  if (kind === 'password') return <PasswordResult data={data} notify={notify} />;
  if (kind === 'signature') return <SignatureResult data={data} />;
  if (kind === 'metadata') return <MetadataResult data={data} />;
  if (kind === 'media-inspect') return <MediaInspectResult data={data} />;
  if (kind === 'archive-listing') return <ArchiveListingResult data={data} />;
  return <JsonGeneric data={data} notify={notify} />;
}

/**
 * Typed body for a completed job. Parent card owns download/delete chrome.
 */
export default function JobResultBody({ job, notify }) {
  if (!job || job.status !== 'completed' || !job.downloadUrl) return null;
  const kind = classifyJobResult(job);
  if (kind === 'image') return <ImageBody job={job} notify={notify} />;
  if (kind === 'json') return <JsonBody job={job} notify={notify} />;
  if (kind === 'text') {
    return <TextLoader job={job} notify={notify} />;
  }
  return null;
}

function TextLoader({ job, notify }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => {
    let cancelled = false;
    api.fetchJobText(job.id)
      .then((t) => { if (!cancelled) setText(t); })
      .catch((e) => { if (!cancelled) setErr(e?.message || 'Failed'); });
    return () => { cancelled = true; };
  }, [job.id]);
  if (err) return <p className="helper-note">{err}</p>;
  if (!text) return <p className="helper-note">Loading text…</p>;
  return <TextBody text={text} notify={notify} />;
}

export {
  HashTable,
  CompareResult,
  PasswordResult,
  SignatureResult,
  MetadataResult,
  MediaInspectResult,
  ArchiveListingResult,
};

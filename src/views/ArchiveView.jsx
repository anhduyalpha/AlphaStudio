import React, { useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, Panel } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, CapabilityBanner } from '../components/Workbench';
import { SegmentedControl, FileRow, FileRowList } from '../components/StudioPrimitives';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';
import { api } from '../api/client';

const MODES = [
  { id: 'create', label: 'Create', icon: 'archive', capability: 'archive.zip' },
  { id: 'extract', label: 'Extract', icon: 'download', capability: 'archive.zip' },
  { id: 'inspect', label: 'Inspect', icon: 'eye', capability: 'archive.zip' },
];

export default function ArchiveView({ notify }) {
  const [mode, setMode] = useState('create');
  const [files, setFiles] = useState([]);
  const [format, setFormat] = useState('zip');
  const [entries, setEntries] = useState([]);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason, loading: capsLoading } = useCapabilities();

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const capKey = mode === 'create' && format === '7z' ? 'archive.7z' : mode === 'create' && format === 'tar' ? 'archive.tar' : mode === 'create' && format === 'gz' ? 'archive.gz' : modeMeta.capability;
  const unavailable = capsLoading ? false : isAvailable(capKey) === false;

  const start = async () => {
    if (unavailable) {
      notify(`Unavailable: ${reason(capKey) || capKey}`);
      return;
    }
    if (!files.length) {
      notify(mode === 'create' ? 'Add files to archive' : 'Choose an archive file');
      return;
    }
    try {
      const result = await run('archive', {
        files: mode === 'create' ? files : files.slice(0, 1),
        options: {
          operation: mode,
          format: mode === 'extract' ? 'auto' : format,
        },
        autoDownload: false,
      });
      if (mode === 'inspect' && result?.id) {
        try {
          const text = await api.fetchJobText(result.id);
          const parsed = JSON.parse(text);
          const list = parsed.entries || parsed.files || parsed.contents || [];
          setEntries(Array.isArray(list) ? list : []);
          if (!Array.isArray(list) && parsed) {
            // flatten common shapes
            const flat = [];
            const walk = (node, prefix = '') => {
              if (!node) return;
              if (typeof node === 'string') flat.push({ name: prefix + node });
              else if (Array.isArray(node)) node.forEach((n) => walk(n, prefix));
              else if (typeof node === 'object') {
                if (node.name || node.path) flat.push(node);
                Object.values(node).forEach((v) => walk(v, prefix));
              }
            };
            walk(parsed);
            if (flat.length) setEntries(flat);
          }
        } catch {
          setEntries([]);
        }
      }
    } catch {
      /* notify in hook */
    }
  };

  const entryRows = useMemo(() => entries.slice(0, 200).map((e, i) => {
    if (typeof e === 'string') return { key: `${i}-${e}`, name: e, meta: '' };
    const name = e.name || e.path || e.entry || `entry-${i}`;
    const size = e.size ?? e.uncompressedSize ?? e.compressedSize;
    return {
      key: `${i}-${name}`,
      name,
      meta: [e.type, size != null ? `${size} B` : null].filter(Boolean).join(' · '),
    };
  }), [entries]);

  return (
    <div className="view-stack archive-workspace family-archive" data-testid="archive-workspace">
      <WorkspaceHeader
        meta="More tools / Archive Center"
        title="Archive workspace"
        description="Create, extract, and inspect local archives. Contents list is the primary object in Inspect mode."
        family="archive"
        status={(
          <StatusBadge tone={unavailable ? 'neutral' : busy ? 'cyan' : 'purple'} status={unavailable ? 'unavailable' : busy ? 'converting' : 'completed'} live={busy}>
            {unavailable ? 'Unavailable' : busy ? status || 'Running' : mode}
          </StatusBadge>
        )}
      />

      <SegmentedControl label="Archive modes" value={mode} onChange={(m) => { setMode(m); setEntries([]); }} options={MODES.map((m) => ({ id: m.id, label: m.label, icon: m.icon }))} />

      {unavailable ? <CapabilityBanner title="Archive tool unavailable" reason={reason(capKey) || capKey} /> : null}

      <WorkbenchLayout
        family="archive"
        stage={(
          <Panel title={mode === 'inspect' ? 'Archive contents' : mode === 'extract' ? 'Archive to extract' : 'Files to pack'}>
            <FilePicker
              accept={mode === 'create' ? '*/*' : '.zip,.tar,.gz,.tgz,.7z,application/zip,application/x-tar,application/gzip'}
              multiple={mode === 'create'}
              files={files}
              onChange={setFiles}
              disabled={busy}
              title={mode === 'create' ? 'Drop files to archive' : 'Drop an archive'}
            />
            {files.length ? (
              <FileRowList label="Selected files">
                {files.map((f, i) => (
                  <FileRow key={`${f.name}-${i}`} name={f.name} meta={`${(f.size / 1024).toFixed(1)} KB`} status="ready" />
                ))}
              </FileRowList>
            ) : (
              <EmptyState type="noResults" compact title="No files yet" description={mode === 'create' ? 'Add files to build an archive.' : 'Choose a ZIP, TAR, GZ, or 7Z file.'} />
            )}
            {mode === 'inspect' ? (
              <div className="archive-tree" style={{ marginTop: 16 }}>
                <h3 className="panel-card-title" style={{ marginBottom: 8 }}>Contents tree</h3>
                {!entryRows.length ? (
                  <p className="helper-note">Run Inspect to list archive entries here.</p>
                ) : (
                  <FileRowList label="Archive entries">
                    {entryRows.map((row) => (
                      <FileRow key={row.key} name={row.name} meta={row.meta || 'entry'} leading={<span className="file-type-icon">·</span>} />
                    ))}
                  </FileRowList>
                )}
              </div>
            ) : null}
            {busy ? <ProgressWave value={progress} label="Archive job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title={`${modeMeta.label} options`}>
            {mode === 'create' ? (
              <SelectField label="Archive format" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="zip">ZIP</option>
                <option value="tar">TAR</option>
                <option value="gz">GZ (single file)</option>
                <option value="7z">7Z (when available)</option>
              </SelectField>
            ) : (
              <p className="workspace-description" style={{ margin: 0 }}>
                {mode === 'extract'
                  ? 'Format is auto-detected from magic bytes and extension.'
                  : 'Inspect returns entry names and sizes without full extraction.'}
              </p>
            )}
            <div className="preview-info-list" style={{ marginTop: 12 }}>
              <div><span>Mode</span><strong>{modeMeta.label}</strong></div>
              <div><span>Files</span><strong>{files.length}</strong></div>
              <div><span>Entries listed</span><strong>{entryRows.length}</strong></div>
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{modeMeta.label}</strong>
              <span>{unavailable ? 'Blocked' : busy ? `${progress}%` : files.length ? 'Ready' : 'Need files'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton icon="archive" onClick={start} disabled={busy || unavailable || !files.length} busy={busy}>
                {unavailable ? 'Unavailable' : `Run ${modeMeta.label.toLowerCase()}`}
              </PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}

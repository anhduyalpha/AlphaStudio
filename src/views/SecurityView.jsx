import React, { useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, Panel, TextField, ToggleRow } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, CapabilityBanner } from '../components/Workbench';
import { SegmentedControl, FileRow } from '../components/StudioPrimitives';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';

const MODES = [
  { id: 'hash', label: 'Hash', capability: 'security.hash', needsFile: true },
  { id: 'compare', label: 'Compare', capability: 'security.hash', needsFile: true },
  { id: 'metadata', label: 'Metadata', capability: 'security.metadata', needsFile: true },
  { id: 'signature', label: 'Signature', capability: 'security.signature', needsFile: true },
  { id: 'password', label: 'Password', capability: 'security.hash', needsFile: false },
];

export default function SecurityView({ notify }) {
  const [mode, setMode] = useState('hash');
  const [files, setFiles] = useState([]);
  const [algorithm, setAlgorithm] = useState('sha256');
  const [expected, setExpected] = useState('');
  const [length, setLength] = useState('20');
  const [symbols, setSymbols] = useState(true);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason, loading: capsLoading } = useCapabilities();

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const unavailable = !capsLoading && isAvailable(modeMeta.capability) === false;

  const start = async () => {
    if (unavailable) {
      notify(`Unavailable: ${reason(modeMeta.capability) || modeMeta.capability}`);
      return;
    }
    if (modeMeta.needsFile && !files.length) {
      notify('Choose a file first');
      return;
    }
    if (mode === 'compare') {
      const hex = expected.trim();
      if (!/^[a-fA-F0-9]{32,128}$/.test(hex)) {
        notify('Enter a valid expected checksum (hex, 32–128 chars).');
        return;
      }
    }
    try {
      await run(mode === 'password' ? 'security' : 'security', {
        files: modeMeta.needsFile ? files.slice(0, 1) : [],
        options: {
          operation: mode,
          algorithms: mode === 'hash' ? ['md5', 'sha1', 'sha256', 'sha512'] : undefined,
          algorithm: mode === 'compare' ? algorithm : undefined,
          expected: mode === 'compare' ? expected.trim().toLowerCase() : undefined,
          length: mode === 'password' ? Number(length) || 20 : undefined,
          symbols: mode === 'password' ? symbols : undefined,
        },
        autoDownload: false,
      });
    } catch {
      /* hook */
    }
  };

  return (
    <div className="view-stack security-workspace family-neutral" data-testid="security-workspace">
      <WorkspaceHeader
        meta="More tools / Security Lab"
        title="Security inspector"
        description="Dedicated flows for hashing, checksum compare, metadata, signatures, and passwords — no generic preserve-metadata preset."
        status={(
          <StatusBadge tone={unavailable ? 'neutral' : busy ? 'cyan' : 'green'} status={unavailable ? 'unavailable' : busy ? 'converting' : 'completed'} live={busy}>
            {unavailable ? 'Unavailable' : busy ? status || 'Running' : mode}
          </StatusBadge>
        )}
      />

      <SegmentedControl
        label="Security modes"
        value={mode}
        onChange={setMode}
        options={MODES.map((m) => ({ id: m.id, label: m.label }))}
      />

      {unavailable ? <CapabilityBanner title="Security capability unavailable" reason={reason(modeMeta.capability) || modeMeta.capability} /> : null}

      <WorkbenchLayout
        family="neutral"
        stage={(
          <Panel title={modeMeta.needsFile ? 'Target file' : 'Generator'}>
            {modeMeta.needsFile ? (
              <>
                <FilePicker accept="*/*" multiple={false} files={files} onChange={setFiles} disabled={busy} title="Drop a file to inspect" />
                {files[0] ? <FileRow name={files[0].name} meta={`${(files[0].size / 1024).toFixed(1)} KB`} status="ready" /> : (
                  <EmptyState type="noResults" compact title="No file" description="Hash, compare, metadata, and signature require a local file." />
                )}
              </>
            ) : (
              <EmptyState type="noResults" compact title="Password generator" description="No file required. Configure length and symbol policy in the rail." />
            )}
            {busy ? <ProgressWave value={progress} label="Security job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title={`${modeMeta.label} options`}>
            {mode === 'hash' ? (
              <p className="workspace-description" style={{ margin: 0 }}>Computes MD5, SHA-1, SHA-256, and SHA-512 digests for the selected file.</p>
            ) : null}
            {mode === 'compare' ? (
              <div className="form-grid">
                <SelectField label="Algorithm" value={algorithm} onChange={(e) => setAlgorithm(e.target.value)}>
                  <option value="md5">MD5</option>
                  <option value="sha1">SHA-1</option>
                  <option value="sha256">SHA-256</option>
                  <option value="sha512">SHA-512</option>
                </SelectField>
                <TextField label="Expected checksum (hex)" value={expected} onChange={(e) => setExpected(e.target.value)} placeholder="paste hex digest" />
              </div>
            ) : null}
            {mode === 'metadata' ? (
              <p className="workspace-description" style={{ margin: 0 }}>Reports size, MIME, and EXIF presence for local inspection.</p>
            ) : null}
            {mode === 'signature' ? (
              <p className="workspace-description" style={{ margin: 0 }}>Compares extension vs magic-byte signature.</p>
            ) : null}
            {mode === 'password' ? (
              <>
                <TextField label="Length" value={length} onChange={(e) => setLength(e.target.value)} />
                <ToggleRow title="Include symbols" description="Use punctuation in the generated password." checked={symbols} onChange={(e) => setSymbols(e.target.checked)} />
              </>
            ) : null}
            <div className="preview-info-list" style={{ marginTop: 12 }}>
              <div><span>Mode</span><strong>{modeMeta.label}</strong></div>
              <div><span>File required</span><strong>{modeMeta.needsFile ? 'Yes' : 'No'}</strong></div>
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{modeMeta.label}</strong>
              <span>{unavailable ? 'Blocked' : busy ? `${progress}%` : 'Ready'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton
                icon="shield"
                onClick={start}
                disabled={busy || unavailable || (modeMeta.needsFile && !files.length)}
                busy={busy}
              >
                {unavailable ? 'Unavailable' : `Run ${modeMeta.label.toLowerCase()}`}
              </PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}

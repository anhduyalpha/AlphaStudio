import React, { useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, Panel } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, CapabilityBanner } from '../components/Workbench';
import { SegmentedControl } from '../components/StudioPrimitives';
import DiffView from '../components/text/DiffView';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';
import {
  copyText,
  downloadText,
  editorStats,
  summarizeDiff,
  diffLines,
} from '../lib/textDiff';

const MODES = [
  { id: 'cleanup', label: 'Cleanup', capability: 'text.cleanup', needsFile: true },
  { id: 'word-count', label: 'Analyze', capability: 'text.cleanup', needsFile: true },
  { id: 'case', label: 'Case', capability: 'text.cleanup', needsFile: true },
  { id: 'hash', label: 'Hash', capability: 'text.hash', needsFile: true },
  { id: 'editor', label: 'Editor', clientOnly: true },
  { id: 'compare', label: 'Compare', clientOnly: true },
  { id: 'ocr', label: 'OCR', capability: 'text.ocr', clientOnly: true, blocked: true },
];

export default function TextView({ notify }) {
  const [mode, setMode] = useState('cleanup');
  const [files, setFiles] = useState([]);
  const [caseMode, setCaseMode] = useState('title');
  const [left, setLeft] = useState('');
  const [right, setRight] = useState('');
  const [editor, setEditor] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason, loading: capsLoading } = useCapabilities();

  const modeMeta = MODES.find((m) => m.id === mode) || MODES[0];
  const unavailable = !modeMeta.clientOnly && !capsLoading && modeMeta.capability && isAvailable(modeMeta.capability) === false;
  const stats = useMemo(() => editorStats(editor), [editor]);
  const diffSummary = useMemo(() => summarizeDiff(diffLines(left, right)), [left, right]);

  const applyCase = (text, which) => {
    if (which === 'upper') return text.toUpperCase();
    if (which === 'lower') return text.toLowerCase();
    if (which === 'title') return text.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());
    return text;
  };

  const runClient = async () => {
    if (mode === 'editor') {
      notify(`Editor: ${stats.words} words · ${stats.characters} chars · ${stats.lines} lines`);
      return;
    }
    if (mode === 'compare') {
      setShowDiff(true);
      notify(diffSummary.identical ? 'Texts are identical' : `Diff: +${diffSummary.added} / −${diffSummary.removed} lines`);
      return;
    }
    if (mode === 'ocr') {
      notify('OCR is not available: no OCR engine is bundled.');
    }
  };

  const start = async () => {
    if (modeMeta.clientOnly || modeMeta.blocked) {
      await runClient();
      return;
    }
    if (unavailable) {
      notify(`Unavailable: ${reason(modeMeta.capability) || modeMeta.capability}`);
      return;
    }
    if (!files.length) {
      notify('Add a text file first');
      return;
    }
    try {
      await run('text', {
        files: files.slice(0, 1),
        options: {
          operation: mode,
          caseMode,
          algorithm: 'sha256',
        },
        autoDownload: false,
      });
    } catch {
      /* hook */
    }
  };

  return (
    <div className="view-stack text-workspace family-neutral" data-testid="text-workspace">
      <WorkspaceHeader
        meta="More tools / Text & OCR"
        title="Text workspace"
        description="Editor and line/word compare run in the browser. Cleanup, case, analyze, and hash use the local API."
        status={(
          <StatusBadge tone={modeMeta.blocked || unavailable ? 'neutral' : busy ? 'cyan' : 'cyan'} status={modeMeta.blocked ? 'unavailable' : busy ? 'converting' : 'completed'} live={busy}>
            {modeMeta.blocked ? 'OCR unavailable' : busy ? status || 'Running' : mode}
          </StatusBadge>
        )}
      />

      <SegmentedControl
        label="Text modes"
        value={mode}
        onChange={(m) => { setMode(m); setShowDiff(false); }}
        options={MODES.map((m) => ({ id: m.id, label: m.label }))}
      />

      {(unavailable || modeMeta.blocked) ? (
        <CapabilityBanner
          title={modeMeta.blocked ? 'OCR unavailable' : 'Text tool unavailable'}
          reason={modeMeta.blocked ? 'No OCR engine is bundled in this build.' : (reason(modeMeta.capability) || modeMeta.capability)}
        />
      ) : null}

      <WorkbenchLayout
        family="neutral"
        stage={(
          <Panel title={modeMeta.clientOnly ? 'Text surface' : 'Source file'}>
            {mode === 'editor' ? (
              <>
                <label className="field-group">
                  <span className="field-label">Editor</span>
                  <textarea rows={14} value={editor} onChange={(e) => setEditor(e.target.value)} style={{ width: '100%' }} data-testid="text-editor" />
                </label>
                <div className="preview-info-list" style={{ marginTop: 12 }}>
                  <div><span>Words</span><strong>{stats.words}</strong></div>
                  <div><span>Characters</span><strong>{stats.characters}</strong></div>
                  <div><span>Lines</span><strong>{stats.lines}</strong></div>
                </div>
              </>
            ) : null}
            {mode === 'compare' ? (
              <>
                <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <label className="field-group">
                    <span className="field-label">Left</span>
                    <textarea rows={10} value={left} onChange={(e) => { setLeft(e.target.value); setShowDiff(false); }} style={{ width: '100%' }} data-testid="text-diff-left" />
                  </label>
                  <label className="field-group">
                    <span className="field-label">Right</span>
                    <textarea rows={10} value={right} onChange={(e) => { setRight(e.target.value); setShowDiff(false); }} style={{ width: '100%' }} data-testid="text-diff-right" />
                  </label>
                </div>
                {showDiff ? <DiffView left={left} right={right} /> : (
                  <p className="helper-note" style={{ marginTop: 12 }}>Run compare to render a line/word diff.</p>
                )}
              </>
            ) : null}
            {!modeMeta.clientOnly ? (
              <FilePicker accept=".txt,.json,.md,.csv,text/*" multiple={false} files={files} onChange={setFiles} disabled={busy} title="Drop a text file" />
            ) : null}
            {!modeMeta.clientOnly && !files.length ? (
              <EmptyState type="noResults" compact title="No file" description="Upload text for cleanup, analyze, case, or hash jobs." />
            ) : null}
            {busy ? <ProgressWave value={progress} label="Text job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title="Options">
            {mode === 'case' ? (
              <SelectField label="Case mode" value={caseMode} onChange={(e) => setCaseMode(e.target.value)}>
                <option value="title">Title Case</option>
                <option value="upper">UPPER</option>
                <option value="lower">lower</option>
                <option value="sentence">Sentence</option>
              </SelectField>
            ) : (
              <p className="workspace-description" style={{ margin: 0 }}>
                {modeMeta.clientOnly
                  ? 'This mode runs entirely in your browser — no server job.'
                  : 'Backend text processor writes results you can download from the card below.'}
              </p>
            )}
            {mode === 'editor' ? (
              <div className="hero-button-row" style={{ marginTop: 12, flexWrap: 'wrap' }} data-testid="text-editor-actions">
                <SecondaryButton size="sm" icon="copy" onClick={async () => {
                  const ok = await copyText(editor);
                  notify(ok ? 'Copied editor text' : 'Copy failed');
                }}>Copy</SecondaryButton>
                <SecondaryButton size="sm" icon="download" onClick={() => {
                  downloadText('editor.txt', editor);
                  notify('Downloaded editor.txt');
                }}>Export .txt</SecondaryButton>
                <SecondaryButton size="sm" onClick={() => setEditor(applyCase(editor, 'upper'))}>UPPER</SecondaryButton>
                <SecondaryButton size="sm" onClick={() => setEditor(applyCase(editor, 'lower'))}>lower</SecondaryButton>
                <SecondaryButton size="sm" onClick={() => setEditor(applyCase(editor, 'title'))}>Title</SecondaryButton>
                <SecondaryButton size="sm" icon="trash" onClick={() => { setEditor(''); notify('Editor cleared'); }}>Clear</SecondaryButton>
              </div>
            ) : null}
            {mode === 'compare' ? (
              <div className="preview-info-list" style={{ marginTop: 12 }}>
                <div><span>+ lines</span><strong>{diffSummary.added}</strong></div>
                <div><span>− lines</span><strong>{diffSummary.removed}</strong></div>
              </div>
            ) : null}
            <div className="preview-info-list" style={{ marginTop: 12 }}>
              <div><span>Mode</span><strong>{modeMeta.label}</strong></div>
              <div><span>Path</span><strong>{modeMeta.clientOnly ? 'Browser' : 'Local API'}</strong></div>
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{modeMeta.label}</strong>
              <span>{modeMeta.blocked ? 'Blocked' : busy ? `${progress}%` : 'Ready'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton
                icon="scan"
                onClick={start}
                disabled={busy || unavailable || modeMeta.blocked || (!modeMeta.clientOnly && !files.length)}
                busy={busy}
              >
                {modeMeta.blocked ? 'Unavailable' : modeMeta.clientOnly ? 'Run in browser' : 'Run text job'}
              </PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}

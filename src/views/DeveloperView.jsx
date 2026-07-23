import React, { useMemo, useState } from 'react';
import Icon from '../components/Icon';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge } from '../components/Common';
import { WorkspaceHeader } from '../components/Workbench';
import { api } from '../api/client';

const exampleInput = `{"studio":"AlphaStudio","mode":"local-api","tools":["convert","pdf","qr"]}`;

const UTIL_MAP = {
  'JSON Formatter': { operation: 'format-json', needsJsonOptions: true },
  'Base64 Encode': { operation: 'base64-encode' },
  'Base64 Decode': { operation: 'base64-decode' },
  'URL Encode': { operation: 'url-encode' },
  'URL Decode': { operation: 'url-decode' },
  'SHA-256 Hash': { operation: 'hash', algorithm: 'sha256' },
  'Text Cleaner': { operation: 'cleanup' },
  'UUID Generator': { operation: 'uuid', count: 1, noInput: true },
};

export default function DeveloperView({ notify }) {
  const [utility, setUtility] = useState('JSON Formatter');
  const [input, setInput] = useState(exampleInput);
  const [output, setOutput] = useState('');
  const [indent, setIndent] = useState('2');
  const [sortKeys, setSortKeys] = useState('off');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cfg = UTIL_MAP[utility] || { operation: 'cleanup' };
  const footer = useMemo(() => `${input.length} characters`, [input]);

  const runUtility = async () => {
    setBusy(true);
    setError('');
    try {
      const job = await api.runJob('text', {
        files: [],
        options: {
          operation: cfg.operation,
          input: cfg.noInput ? undefined : input,
          algorithm: cfg.algorithm,
          count: cfg.count,
          indent: Number(indent) || 2,
          sortKeys: sortKeys === 'on',
        },
        autoDownload: false,
      });
      const text = await api.fetchJobText(job.id);
      try {
        const parsed = JSON.parse(text);
        if (parsed.digest) setOutput(parsed.digest);
        else if (parsed.uuids) setOutput(parsed.uuids.join('\n'));
        else setOutput(JSON.stringify(parsed, null, 2));
      } catch {
        setOutput(text);
      }
      notify(`${utility} completed`);
    } catch (err) {
      const msg = err.message || 'Utility failed';
      setError(msg);
      notify(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-stack developer-workspace family-neutral" data-testid="developer-workspace">
      <WorkspaceHeader
        meta="Tools / Developer Utilities"
        title="Developer inspector"
        description="Format JSON, encode or decode Base64 and URLs, generate hashes, and clean text via the local API."
        status={<StatusBadge tone={error ? 'danger' : busy ? 'cyan' : 'green'} live={busy}>{error ? 'Error' : busy ? 'Running' : 'Ready'}</StatusBadge>}
        actions={
          <PrimaryButton icon="play" onClick={runUtility} disabled={busy} busy={busy} data-testid="developer-run">
            Run utility
          </PrimaryButton>
        }
      />
      {error ? (
        <div className="surface-card content-card" data-testid="developer-error" role="alert">
          <p className="helper-note" style={{ margin: 0, color: 'var(--danger, #f87171)' }}>{error}</p>
        </div>
      ) : null}
      <section className="dev-layout inspector-workspace" data-testid="developer-inspector">
        <aside className="surface-card dev-tool-list workbench-rail" aria-label="Utilities">
          <p className="eyebrow">Utilities</p>
          {Object.keys(UTIL_MAP).map((name, index) => (
            <button
              type="button"
              key={name}
              className={utility === name ? 'active' : ''}
              onClick={() => { setUtility(name); setError(''); }}
              data-testid={`developer-util-${index}`}
            >
              <span className={`dev-icon dev-${index % 6}`}>
                <Icon name={index === 0 ? 'code' : index === 5 ? 'lock' : 'swap'} size={17} />
              </span>
              <span>{name}</span>
            </button>
          ))}
        </aside>
        <article className="surface-card code-workspace">
          <div className="code-toolbar">
            <div>
              <p className="eyebrow">Current utility</p>
              <h3>{utility}</h3>
            </div>
            <div className="button-row">
              <SecondaryButton icon="trash" onClick={() => { setInput(''); setOutput(''); setError(''); notify('Input cleared'); }}>Clear</SecondaryButton>
              <SecondaryButton
                icon="copy"
                data-testid="developer-copy-output"
                disabled={!output}
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(output);
                    notify('Output copied');
                  } catch {
                    notify('Copy failed');
                  }
                }}
              >
                Copy output
              </SecondaryButton>
            </div>
          </div>
          <div className="code-panels">
            <label>
              <span>Input{cfg.noInput ? ' (unused)' : ''}</span>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck="false"
                disabled={Boolean(cfg.noInput)}
                data-testid="developer-input"
              />
            </label>
            <label>
              <span>Output</span>
              <textarea
                value={output}
                readOnly
                spellCheck="false"
                placeholder={busy ? 'Running…' : 'Run a utility to see output'}
                data-testid="developer-output"
              />
            </label>
          </div>
          <div className="code-footer">
            <span>UTF-8</span>
            <span>Local API</span>
            <span>{footer}</span>
          </div>
        </article>
        <aside className="surface-card content-card utility-options">
          <p className="eyebrow">Options</p>
          <h3>{cfg.needsJsonOptions ? 'JSON formatting' : 'Utility'}</h3>
          {cfg.needsJsonOptions ? (
            <div className="single-column-form" data-testid="developer-json-options">
              <SelectField label="Indentation" value={indent} onChange={(e) => setIndent(e.target.value)}>
                <option value="2">2 spaces</option>
                <option value="4">4 spaces</option>
              </SelectField>
              <SelectField label="Sort keys" value={sortKeys} onChange={(e) => setSortKeys(e.target.value)}>
                <option value="off">Keep original</option>
                <option value="on">Alphabetical</option>
              </SelectField>
            </div>
          ) : (
            <p className="helper-note" data-testid="developer-options-note">
              No extra options for this utility. Output appears after Run.
            </p>
          )}
          <div className="tip-card">
            <Icon name="check" />
            <p>
              <strong>Backend connected</strong>
              <span>Utilities execute on the AlphaStudio Node API.</span>
            </p>
          </div>
        </aside>
      </section>
    </div>
  );
}

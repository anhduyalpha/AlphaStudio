import React, { useMemo, useState } from 'react';
import Icon from '../components/Icon';
import { PageIntro, PrimaryButton, SecondaryButton, SelectField } from '../components/Common';
import { api } from '../api/client';

const exampleInput = `{"studio":"AlphaStudio","mode":"local-api","tools":["convert","pdf","qr"]}`;

const UTIL_MAP = {
  'JSON Formatter': { operation: 'format-json' },
  'Base64 Encode': { operation: 'base64-encode' },
  'Base64 Decode': { operation: 'base64-decode' },
  'URL Encode': { operation: 'url-encode' },
  'URL Decode': { operation: 'url-decode' },
  'SHA-256 Hash': { operation: 'hash', algorithm: 'sha256' },
  'Text Cleaner': { operation: 'cleanup' },
  'UUID Generator': { operation: 'uuid', count: 1 },
};

export default function DeveloperView({ notify }) {
  const [utility, setUtility] = useState('JSON Formatter');
  const [input, setInput] = useState(exampleInput);
  const [output, setOutput] = useState('');
  const [indent, setIndent] = useState('2');
  const [sortKeys, setSortKeys] = useState('off');
  const [busy, setBusy] = useState(false);

  const footer = useMemo(() => {
    return `${input.length} characters`;
  }, [input]);

  const runUtility = async () => {
    setBusy(true);
    try {
      const cfg = UTIL_MAP[utility] || { operation: 'cleanup' };
      const job = await api.runJob('text', {
        files: [],
        options: {
          operation: cfg.operation,
          input,
          algorithm: cfg.algorithm,
          count: cfg.count,
          indent: Number(indent) || 2,
          sortKeys: sortKeys === 'on',
        },
        autoDownload: false,
      });
      const text = await api.fetchJobText(job.id);
      // If JSON result, pretty show
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
      notify(err.message || 'Utility failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Tools / Developer Utilities"
        title="Small developer tools, one focused interface."
        description="Format JSON, encode or decode Base64 and URLs, generate hashes, and clean text via the local API."
        actions={
          <PrimaryButton icon="play" onClick={runUtility} disabled={busy}>
            {busy ? 'Running…' : 'Run utility'}
          </PrimaryButton>
        }
      />
      <section className="dev-layout">
        <aside className="surface-card dev-tool-list">
          <p className="eyebrow">Utilities</p>
          {Object.keys(UTIL_MAP).map((name, index) => (
            <button type="button" key={name} className={utility === name ? 'active' : ''} onClick={() => setUtility(name)}>
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
              <SecondaryButton icon="trash" onClick={() => { setInput(''); setOutput(''); notify('Input cleared'); }}>Clear</SecondaryButton>
              <SecondaryButton
                icon="copy"
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
              <span>Input</span>
              <textarea value={input} onChange={(e) => setInput(e.target.value)} spellCheck="false" />
            </label>
            <label>
              <span>Output</span>
              <textarea value={output} readOnly spellCheck="false" />
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
          <h3>Formatting</h3>
          <div className="single-column-form">
            <SelectField label="Indentation" value={indent} onChange={(e) => setIndent(e.target.value)}>
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
            </SelectField>
            <SelectField label="Sort keys" value={sortKeys} onChange={(e) => setSortKeys(e.target.value)}>
              <option value="off">Keep original</option>
              <option value="on">Alphabetical</option>
            </SelectField>
          </div>
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

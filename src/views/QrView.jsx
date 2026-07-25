import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FilePicker from '../components/FilePicker';
import QrPasteModal from '../components/QrPasteModal';
import {
  PrimaryButton,
  SecondaryButton,
  SelectField,
  TextField,
} from '../components/Common';
import { WorkspaceHeader } from '../components/Workbench';
import useJobRunner from '../hooks/useJobRunner';
import { api } from '../api/client';

const DEFAULT_CONTENT = 'https://localhost:5173';
const DEFAULTS = {
  content: DEFAULT_CONTENT,
  label: 'AlphaStudio',
  dark: '#0f172a',
  light: '#ffffff',
  ecc: 'M',
  margin: '2',
  size: '512',
  format: 'png',
};

function detectContentType(text) {
  const t = String(text || '').trim();
  if (!t) return 'empty';
  if (/^https?:\/\//i.test(t)) return 'url';
  if (/^mailto:/i.test(t)) return 'email';
  if (/^tel:/i.test(t)) return 'phone';
  if (/^WIFI:/i.test(t)) return 'wifi';
  if (/^BEGIN:VCARD/i.test(t)) return 'vcard';
  if (/^smsto:/i.test(t) || /^sms:/i.test(t)) return 'sms';
  try {
    const u = new URL(t);
    if (u.protocol === 'http:' || u.protocol === 'https:') return 'url';
  } catch {
    /* not a URL */
  }
  return 'text';
}

function isSafeHttpUrl(text) {
  try {
    const u = new URL(String(text || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function Collapsible({ id, title, open, onToggle, children }) {
  return (
    <div className={`qr-collapse${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="qr-collapse-trigger"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
      >
        <span>{title}</span>
        <span className="qr-collapse-chevron" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div id={id} className="qr-collapse-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}

export default function QrView({ notify }) {
  const [tab, setTab] = useState('generate');
  const [content, setContent] = useState(DEFAULTS.content);
  const [label, setLabel] = useState(DEFAULTS.label);
  const [format, setFormat] = useState(DEFAULTS.format);
  const [size, setSize] = useState(DEFAULTS.size);
  const [dark, setDark] = useState(DEFAULTS.dark);
  const [light, setLight] = useState(DEFAULTS.light);
  const [ecc, setEcc] = useState(DEFAULTS.ecc);
  const [margin, setMargin] = useState(DEFAULTS.margin);
  const [logoFiles, setLogoFiles] = useState([]);
  const [files, setFiles] = useState([]);
  const [decodePreviewUrl, setDecodePreviewUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewFormat, setPreviewFormat] = useState('png');
  const [decoded, setDecoded] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const previewUrlRef = useRef(null);
  const decodePreviewUrlRef = useRef(null);
  const [openSections, setOpenSections] = useState({
    colors: false,
    logo: false,
    ecc: false,
    margin: false,
    format: false,
  });
  const { busy, progress, run, cancel } = useJobRunner(notify);

  const toggleSection = (key) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  // Track current URLs without revoking the other still-visible preview when
  // either state value changes. Cleanup runs once on unmount.
  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);
  useEffect(() => {
    decodePreviewUrlRef.current = decodePreviewUrl;
  }, [decodePreviewUrl]);
  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    if (decodePreviewUrlRef.current) URL.revokeObjectURL(decodePreviewUrlRef.current);
  }, []);

  useEffect(() => {
    if (!files.length) {
      if (decodePreviewUrl) {
        URL.revokeObjectURL(decodePreviewUrl);
        setDecodePreviewUrl(null);
      }
      return;
    }
    const file = files[0];
    const url = URL.createObjectURL(file);
    setDecodePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  }, [files]);

  const contentType = useMemo(() => detectContentType(decoded), [decoded]);
  const canOpenLink = contentType === 'url' && isSafeHttpUrl(decoded);

  const resetGenerate = useCallback(() => {
    setContent(DEFAULTS.content);
    setLabel(DEFAULTS.label);
    setFormat(DEFAULTS.format);
    setSize(DEFAULTS.size);
    setDark(DEFAULTS.dark);
    setLight(DEFAULTS.light);
    setEcc(DEFAULTS.ecc);
    setMargin(DEFAULTS.margin);
    setLogoFiles([]);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setPreviewFormat('png');
    notify?.('Generate settings reset');
  }, [notify, previewUrl]);

  const generate = async (forceFormat) => {
    if (!content.trim()) {
      notify('Enter QR content');
      return null;
    }
    const outFormat = forceFormat || format;
    try {
      const job = await run('qr', {
        files: logoFiles.length ? logoFiles : [],
        options: {
          operation: 'generate',
          content,
          format: outFormat,
          size: Number(size) || 512,
          margin: Number(margin) || 2,
          dark,
          light,
          ecc,
          logo: logoFiles.length > 0,
        },
        autoDownload: false,
      });
      if (job?.id) {
        const blob = await api.fetchJobBlob(job.id);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setPreviewFormat(outFormat);
        notify('QR generated');
        return job;
      }
    } catch {
      /* handled by useJobRunner */
    }
    return null;
  };

  const downloadBlob = async (forceFormat) => {
    const outFormat = forceFormat || format;
    // Always regenerate for the requested format so PNG/SVG buttons are real
    const job = await generate(outFormat);
    if (!job?.id) return;
    await api.downloadJob(job.id, `qrcode.${outFormat === 'svg' ? 'svg' : 'png'}`);
  };

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(content);
      notify('Content copied');
    } catch {
      notify('Copy failed');
    }
  };

  const copyDecoded = async () => {
    try {
      await navigator.clipboard.writeText(decoded);
      notify('Copied');
    } catch {
      notify('Copy failed');
    }
  };

  const decode = async (sourceFiles) => {
    const list = sourceFiles ?? files;
    if (!list.length) {
      const err = new Error('Choose an image containing a QR code');
      notify(err.message);
      throw err;
    }
    try {
      const job = await run('qr', {
        files: list,
        options: { operation: 'decode' },
        autoDownload: false,
      });
      if (job?.id) {
        const data = await api.fetchJobJson(job.id);
        setDecoded(data.text || JSON.stringify(data));
        notify('QR decoded');
        return job;
      }
      const err = new Error('Decode job did not complete');
      notify(err.message);
      throw err;
    } catch (err) {
      // Propagate failure to caller (always rethrow) so paste modal can show error
      throw err;
    }
  };

  const decodeFromPaste = async (file) => {
    setFiles([file]);
    await decode([file]);
  };

  const retryDecode = async () => {
    if (!files.length) {
      setPasteOpen(true);
      return;
    }
    await decode(files);
  };

  const removeDecodeImage = () => {
    setFiles([]);
    setDecoded('');
    if (decodePreviewUrl) {
      URL.revokeObjectURL(decodePreviewUrl);
      setDecodePreviewUrl(null);
    }
  };

  return (
    <div className="view-stack qr-lab inspector-workspace family-qr" data-testid="qr-inspector-workspace">
      <WorkspaceHeader
        meta="Core tools / QR Lab"
        title="QR Lab"
        description="Generate scannable codes or decode images locally. Encode form and decode stage share one dual-mode inspector."
        family="qr"
        actions={
          busy ? (
            <SecondaryButton icon="close" onClick={cancel}>
              Cancel {progress}%
            </SecondaryButton>
          ) : null
        }
      />

      <div className="qr-tabs" role="tablist" aria-label="QR Lab mode">
        <button
          type="button"
          role="tab"
          className={`qr-tab${tab === 'generate' ? ' is-active' : ''}`}
          aria-selected={tab === 'generate'}
          onClick={() => setTab('generate')}
        >
          Generate
        </button>
        <button
          type="button"
          role="tab"
          className={`qr-tab${tab === 'decode' ? ' is-active' : ''}`}
          aria-selected={tab === 'decode'}
          onClick={() => setTab('decode')}
        >
          Decode
        </button>
      </div>

      {tab === 'generate' ? (
        <section className="qr-generate-layout">
          <div className="qr-generate-settings">
            <article className="surface-card content-card qr-section-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">1 · Content</p>
                  <h3>What to encode</h3>
                </div>
              </div>
              <div className="form-grid">
                <TextField
                  label="Content"
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="URL or text"
                />
                <TextField
                  label="Label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Optional caption"
                />
              </div>
            </article>

            <article className="surface-card content-card qr-section-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">2 · Appearance</p>
                  <h3>Style &amp; options</h3>
                </div>
              </div>
              <div className="qr-advanced-stack">
                <Collapsible
                  id="qr-colors"
                  title="Colors"
                  open={openSections.colors}
                  onToggle={() => toggleSection('colors')}
                >
                  <div className="qr-color-row">
                    <label className="qr-color-field">
                      <span>Foreground</span>
                      <input type="color" value={dark} onChange={(e) => setDark(e.target.value)} />
                      <input
                        type="text"
                        value={dark}
                        onChange={(e) => setDark(e.target.value)}
                        aria-label="Foreground hex"
                      />
                    </label>
                    <label className="qr-color-field">
                      <span>Background</span>
                      <input type="color" value={light} onChange={(e) => setLight(e.target.value)} />
                      <input
                        type="text"
                        value={light}
                        onChange={(e) => setLight(e.target.value)}
                        aria-label="Background hex"
                      />
                    </label>
                  </div>
                </Collapsible>

                <Collapsible
                  id="qr-logo"
                  title="Logo"
                  open={openSections.logo}
                  onToggle={() => toggleSection('logo')}
                >
                  <p className="qr-hint">Optional center logo (PNG works best; use higher error correction).</p>
                  <FilePicker
                    accept="image/*"
                    multiple={false}
                    files={logoFiles}
                    onChange={setLogoFiles}
                    disabled={busy}
                    title="Drop logo image"
                  />
                </Collapsible>

                <Collapsible
                  id="qr-ecc"
                  title="Error correction"
                  open={openSections.ecc}
                  onToggle={() => toggleSection('ecc')}
                >
                  <SelectField label="Level" value={ecc} onChange={(e) => setEcc(e.target.value)}>
                    <option value="L">L — ~7%</option>
                    <option value="M">M — ~15% (default)</option>
                    <option value="Q">Q — ~25%</option>
                    <option value="H">H — ~30%</option>
                  </SelectField>
                </Collapsible>

                <Collapsible
                  id="qr-margin"
                  title="Margin / size"
                  open={openSections.margin}
                  onToggle={() => toggleSection('margin')}
                >
                  <div className="form-grid qr-two-col">
                    <SelectField label="Size" value={size} onChange={(e) => setSize(e.target.value)}>
                      <option value="256">256 px</option>
                      <option value="512">512 px</option>
                      <option value="1024">1024 px</option>
                    </SelectField>
                    <SelectField label="Margin" value={margin} onChange={(e) => setMargin(e.target.value)}>
                      <option value="0">0</option>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="4">4</option>
                    </SelectField>
                  </div>
                </Collapsible>

                <Collapsible
                  id="qr-format"
                  title="Output format"
                  open={openSections.format}
                  onToggle={() => toggleSection('format')}
                >
                  <SelectField label="Default format" value={format} onChange={(e) => setFormat(e.target.value)}>
                    <option value="png">PNG</option>
                    <option value="svg">SVG</option>
                  </SelectField>
                </Collapsible>
              </div>
            </article>

            <div className="qr-primary-actions">
              <PrimaryButton icon="qr" onClick={() => generate()} disabled={busy}>
                {busy && tab === 'generate' ? `${progress}%` : 'Generate'}
              </PrimaryButton>
              <SecondaryButton icon="refresh" onClick={resetGenerate} disabled={busy}>
                Reset
              </SecondaryButton>
            </div>
          </div>

          <aside className="surface-card content-card qr-preview-panel">
            <div className="qr-preview-top">
              <p className="eyebrow">3 · Preview / export</p>
              <span>
                {size} px · {previewFormat.toUpperCase()}
              </span>
            </div>
            <div className="qr-frame">
              {previewUrl ? (
                previewFormat === 'svg' ? (
                  <img src={previewUrl} alt="Generated QR" className="qr-preview-img" />
                ) : (
                  <img src={previewUrl} alt="Generated QR" className="qr-preview-img" />
                )
              ) : (
                <div className="qr-placeholder" aria-label="QR preview placeholder">
                  Generate to preview
                </div>
              )}
            </div>
            {label ? <strong className="qr-preview-label">{label}</strong> : null}
            <span className="qr-preview-content" title={content}>
              {content}
            </span>
            <div className="qr-actions">
              <SecondaryButton icon="copy" onClick={copyContent} disabled={busy}>
                Copy
              </SecondaryButton>
              <SecondaryButton icon="download" onClick={() => downloadBlob('png')} disabled={busy}>
                Download PNG
              </SecondaryButton>
              <SecondaryButton icon="download" onClick={() => downloadBlob('svg')} disabled={busy}>
                Download SVG
              </SecondaryButton>
            </div>
          </aside>
        </section>
      ) : (
        <section className="qr-decode-layout">
          <article className="surface-card content-card qr-section-card">
            <div className="card-heading">
              <div>
                <p className="eyebrow">Input</p>
                <h3>QR image</h3>
              </div>
            </div>

            {!files.length ? (
              <div className="qr-decode-empty">
                <FilePicker
                  accept="image/*"
                  multiple={false}
                  files={files}
                  onChange={setFiles}
                  disabled={busy}
                  title="Drop QR image"
                />
                <div className="qr-decode-input-actions">
                  <SecondaryButton
                    icon="copy"
                    onClick={() => setPasteOpen(true)}
                    disabled={busy}
                    aria-label="Paste image"
                  >
                    Paste image
                  </SecondaryButton>
                  <span className="qr-hint">Or upload / drag and drop above</span>
                </div>
              </div>
            ) : (
              <div className="qr-decode-has-image">
                <div className="qr-decode-preview-frame">
                  {decodePreviewUrl ? (
                    <img src={decodePreviewUrl} alt="QR image to decode" />
                  ) : null}
                </div>
                <p className="qr-decode-filename">{files[0]?.name || 'image'}</p>
                <div className="button-row qr-decode-actions">
                  <PrimaryButton icon="scan" onClick={() => decode()} disabled={busy}>
                    {busy ? `Decoding… ${progress}%` : <>Decode</>}
                  </PrimaryButton>
                  <SecondaryButton
                    icon="upload"
                    onClick={() => {
                      // Replace via re-open file picker: clear then user picks again
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = 'image/*';
                      input.onchange = () => {
                        const f = input.files?.[0];
                        if (f) setFiles([f]);
                      };
                      input.click();
                    }}
                    disabled={busy}
                    aria-label="Replace image"
                  >
                    Replace
                  </SecondaryButton>
                  <SecondaryButton
                    icon="trash"
                    onClick={removeDecodeImage}
                    disabled={busy}
                    aria-label="Remove image"
                  >
                    Remove
                  </SecondaryButton>
                </div>
              </div>
            )}
          </article>

          {decoded ? (
            <article className="surface-card content-card qr-result-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Result</p>
                  <h3>Decoded content</h3>
                </div>
                <span className="qr-type-badge">{contentType}</span>
              </div>
              <pre className="qr-decode-text" tabIndex={0}>
                {decoded}
              </pre>
              <div className="button-row qr-decode-result-actions">
                <SecondaryButton icon="copy" onClick={copyDecoded} aria-label="Copy decoded text">
                  Copy
                </SecondaryButton>
                {canOpenLink ? (
                  <SecondaryButton
                    icon="link"
                    onClick={() => {
                      window.open(decoded.trim(), '_blank', 'noopener,noreferrer');
                    }}
                    aria-label="Open link"
                  >
                    Open link
                  </SecondaryButton>
                ) : null}
                <SecondaryButton
                  icon="refresh"
                  onClick={retryDecode}
                  disabled={busy}
                  aria-label="Retry decode"
                >
                  Retry
                </SecondaryButton>
              </div>
            </article>
          ) : null}
        </section>
      )}

      <QrPasteModal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onDecoded={decodeFromPaste}
        notify={notify}
        busy={busy}
      />
    </div>
  );
}

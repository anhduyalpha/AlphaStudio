import React, { useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import { PrimaryButton, SecondaryButton, StatusBadge, Panel, TextField } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave } from '../components/Workbench';
import { SegmentedControl } from '../components/StudioPrimitives';
import useJobRunner from '../hooks/useJobRunner';

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return null;
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return null;
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r, g, b) {
  const c = (n) => Math.max(0, Math.min(255, Number(n) || 0)).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function relLuminance({ r, g, b }) {
  const f = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(a, b) {
  const L1 = relLuminance(a);
  const L2 = relLuminance(b);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  return (hi + 0.05) / (lo + 0.05);
}

function paletteFrom(hex) {
  const rgb = hexToRgb(hex) || { r: 155, g: 124, b: 255 };
  const steps = [0.2, 0.4, 0.6, 0.8, 1];
  return steps.map((t) => rgbToHex(
    Math.round(rgb.r * t + 255 * (1 - t) * 0.15),
    Math.round(rgb.g * t + 255 * (1 - t) * 0.15),
    Math.round(rgb.b * t + 255 * (1 - t) * 0.15),
  ));
}

const MODES = [
  { id: 'picker', label: 'Picker' },
  { id: 'palette', label: 'Palette' },
  { id: 'contrast', label: 'Contrast' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'image', label: 'Image ops' },
];

export default function ColorView({ notify }) {
  const [mode, setMode] = useState('picker');
  const [hex, setHex] = useState('#9b7cff');
  const [fg, setFg] = useState('#f7f8fc');
  const [bg, setBg] = useState('#121727');
  const [g1, setG1] = useState('#9b7cff');
  const [g2, setG2] = useState('#49dbe8');
  const [files, setFiles] = useState([]);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);

  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  const palette = useMemo(() => paletteFrom(hex), [hex]);
  const ratio = useMemo(() => {
    const a = hexToRgb(fg);
    const b = hexToRgb(bg);
    if (!a || !b) return null;
    return contrastRatio(a, b);
  }, [fg, bg]);

  const runImage = async (operation) => {
    if (!files.length) {
      notify('Choose an image first');
      return;
    }
    try {
      await run('image', {
        files: files.slice(0, 1),
        options: { operation, format: 'png', quality: 80 },
        autoDownload: false,
      });
    } catch {
      /* hook */
    }
  };

  return (
    <div className="view-stack color-workspace family-neutral" data-testid="color-workspace">
      <WorkspaceHeader
        meta="More tools / Color Studio"
        title="Color workspace"
        description="Interactive picker, palette, contrast, and gradient tools run in the browser. Image optimize/strip use Sharp."
        status={<StatusBadge tone="cyan" status={busy ? 'converting' : 'completed'} live={busy}>{busy ? status || 'Running' : mode}</StatusBadge>}
      />

      <SegmentedControl label="Color modes" value={mode} onChange={setMode} options={MODES.map((m) => ({ id: m.id, label: m.label }))} />

      <WorkbenchLayout
        family="neutral"
        stage={(
          <Panel title="Visual canvas">
            {mode === 'picker' || mode === 'palette' ? (
              <div className="color-swatch-stage" style={{ display: 'grid', gap: 16 }}>
                <div style={{ height: 160, borderRadius: 16, background: hex, border: '1px solid var(--border)' }} />
                {mode === 'palette' ? (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                    {palette.map((c) => (
                      <button key={c} type="button" className="liquid-press" style={{ height: 64, borderRadius: 12, border: '1px solid var(--border)', background: c }} onClick={() => { setHex(c); notify(`Selected ${c}`); }} aria-label={`Swatch ${c}`} />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {mode === 'contrast' ? (
              <div style={{ padding: 24, borderRadius: 16, background: bg, color: fg, border: '1px solid var(--border)' }}>
                <h3 style={{ marginTop: 0 }}>Sample body text</h3>
                <p>Contrast ratio: {ratio ? `${ratio.toFixed(2)}:1` : '—'} · AA body needs 4.5:1 · large text 3:1.</p>
              </div>
            ) : null}
            {mode === 'gradient' ? (
              <div style={{ height: 200, borderRadius: 16, border: '1px solid var(--border)', background: `linear-gradient(135deg, ${g1}, ${g2})` }} />
            ) : null}
            {mode === 'image' ? (
              <>
                <FilePicker accept="image/*" multiple={false} files={files} onChange={setFiles} disabled={busy} />
                {busy ? <ProgressWave value={progress} label="Image color job" /> : null}
                <JobOutputCard job={job} notify={notify} />
              </>
            ) : null}
          </Panel>
        )}
        rail={(
          <Panel title="Controls">
            {(mode === 'picker' || mode === 'palette') ? (
              <>
                <label className="field-group">
                  <span className="field-label">Color</span>
                  <input type="color" value={hex} onChange={(e) => setHex(e.target.value)} style={{ width: '100%', height: 44 }} />
                </label>
                <TextField label="Hex" value={hex} onChange={(e) => setHex(e.target.value)} />
                <div className="preview-info-list">
                  <div><span>RGB</span><strong>{rgb.r}, {rgb.g}, {rgb.b}</strong></div>
                  <div><span>HEX</span><strong>{hex}</strong></div>
                </div>
              </>
            ) : null}
            {mode === 'contrast' ? (
              <>
                <label className="field-group"><span className="field-label">Foreground</span><input type="color" value={fg} onChange={(e) => setFg(e.target.value)} style={{ width: '100%', height: 40 }} /></label>
                <label className="field-group"><span className="field-label">Background</span><input type="color" value={bg} onChange={(e) => setBg(e.target.value)} style={{ width: '100%', height: 40 }} /></label>
                <TextField label="FG hex" value={fg} onChange={(e) => setFg(e.target.value)} />
                <TextField label="BG hex" value={bg} onChange={(e) => setBg(e.target.value)} />
              </>
            ) : null}
            {mode === 'gradient' ? (
              <>
                <label className="field-group"><span className="field-label">Start</span><input type="color" value={g1} onChange={(e) => setG1(e.target.value)} style={{ width: '100%', height: 40 }} /></label>
                <label className="field-group"><span className="field-label">End</span><input type="color" value={g2} onChange={(e) => setG2(e.target.value)} style={{ width: '100%', height: 40 }} /></label>
              </>
            ) : null}
            {mode === 'image' ? (
              <p className="workspace-description" style={{ margin: 0 }}>Optimize or strip metadata on an image for palette workflows via Sharp.</p>
            ) : (
              <p className="helper-note" style={{ marginTop: 12 }}>Browser-only color tools — no server round-trip.</p>
            )}
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{MODES.find((m) => m.id === mode)?.label}</strong>
              <span>{mode === 'image' ? (busy ? `${progress}%` : 'API job') : 'Browser tools'}</span>
            </div>
            <div className="hero-button-row">
              {mode === 'image' ? (
                <>
                  {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
                  <SecondaryButton icon="image" onClick={() => runImage('optimize')} disabled={busy || !files.length}>Optimize</SecondaryButton>
                  <PrimaryButton icon="trash" onClick={() => runImage('strip-metadata')} disabled={busy || !files.length} busy={busy}>Strip metadata</PrimaryButton>
                </>
              ) : (
                <PrimaryButton icon="palette" onClick={() => notify(`${mode} updated`)}>Apply</PrimaryButton>
              )}
            </div>
          </>
        )}
      />
    </div>
  );
}

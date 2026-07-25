import React, { useEffect, useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import { PrimaryButton, SecondaryButton, StatusBadge, Panel, TextField } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave } from '../components/Workbench';
import { SegmentedControl } from '../components/StudioPrimitives';
import useJobRunner from '../hooks/useJobRunner';
import {
  contrastGrade,
  contrastRatio,
  copyText,
  downloadText,
  extractPaletteFromFile,
  hexToRgb,
  paletteFromHex,
  paletteToCssVars,
  paletteToJson,
  paletteToSvg,
} from '../lib/colorPalette';

const MODES = [
  { id: 'picker', label: 'Picker' },
  { id: 'palette', label: 'Palette' },
  { id: 'contrast', label: 'Contrast' },
  { id: 'gradient', label: 'Gradient' },
  { id: 'image', label: 'Image palette' },
];

export default function ColorView({ notify }) {
  const [mode, setMode] = useState('picker');
  const [hex, setHex] = useState('#9b7cff');
  const [fg, setFg] = useState('#f7f8fc');
  const [bg, setBg] = useState('#121727');
  const [g1, setG1] = useState('#9b7cff');
  const [g2, setG2] = useState('#49dbe8');
  const [files, setFiles] = useState([]);
  const [imagePalette, setImagePalette] = useState([]);
  const [extracting, setExtracting] = useState(false);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);

  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  const seedPalette = useMemo(() => paletteFromHex(hex, 5), [hex]);
  const activePalette = mode === 'image' ? imagePalette : seedPalette;
  const ratio = useMemo(() => {
    const a = hexToRgb(fg);
    const b = hexToRgb(bg);
    if (!a || !b) return null;
    return contrastRatio(a, b);
  }, [fg, bg]);
  const grade = useMemo(() => contrastGrade(ratio), [ratio]);

  useEffect(() => {
    if (!files[0] || mode !== 'image') return undefined;
    let cancelled = false;
    setExtracting(true);
    extractPaletteFromFile(files[0], { maxColors: 6 })
      .then((colors) => {
        if (!cancelled) {
          setImagePalette(colors);
          if (colors[0]) setHex(colors[0]);
        }
      })
      .catch((err) => {
        if (!cancelled) notify?.(err?.message || 'Palette extraction failed');
      })
      .finally(() => {
        if (!cancelled) setExtracting(false);
      });
    return () => { cancelled = true; };
  }, [files, mode, notify]);

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

  const doCopy = async (label, text) => {
    const ok = await copyText(text);
    notify?.(ok ? `${label} copied` : 'Copy failed');
  };

  const exportJson = () => {
    const payload = paletteToJson(activePalette, { source: mode, seed: hex });
    downloadText('palette.json', payload, 'application/json');
    notify?.('Exported palette.json');
  };

  const exportCss = () => {
    const css = `:root {\n${paletteToCssVars(activePalette)}\n}\n`;
    downloadText('palette.css', css, 'text/css');
    notify?.('Exported palette.css');
  };

  const exportSvg = () => {
    downloadText('palette.svg', paletteToSvg(activePalette), 'image/svg+xml');
    notify?.('Exported palette.svg');
  };

  return (
    <div className="view-stack color-workspace family-neutral" data-testid="color-workspace">
      <WorkspaceHeader
        meta="More tools / Color Studio"
        title="Color workspace"
        description="Picker, contrast, and gradient run in the browser. Image palette samples real pixels; copy/export produce real payloads."
        status={<StatusBadge tone="cyan" status={busy || extracting ? 'converting' : 'completed'} live={busy || extracting}>{busy ? status || 'Running' : extracting ? 'Sampling…' : mode}</StatusBadge>}
      />

      <SegmentedControl label="Color modes" value={mode} onChange={setMode} options={MODES.map((m) => ({ id: m.id, label: m.label }))} />

      <WorkbenchLayout
        family="neutral"
        stage={(
          <Panel title="Visual canvas">
            {mode === 'picker' || mode === 'palette' || mode === 'image' ? (
              <div className="color-swatch-stage" style={{ display: 'grid', gap: 16 }} data-testid="color-swatch-stage">
                <div style={{ height: 120, borderRadius: 16, background: hex, border: '1px solid var(--border)' }} />
                {(mode === 'palette' || mode === 'image') ? (
                  <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(activePalette.length, 1)}, 1fr)`, gap: 8 }} data-testid="color-palette-swatches">
                    {activePalette.length ? activePalette.map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="liquid-press"
                        style={{ height: 64, borderRadius: 12, border: '1px solid var(--border)', background: c }}
                        onClick={() => { setHex(c); notify?.(`Selected ${c}`); }}
                        aria-label={`Swatch ${c}`}
                      />
                    )) : (
                      <p className="helper-note">{mode === 'image' ? 'Load an image to extract a palette.' : 'No swatches'}</p>
                    )}
                  </div>
                ) : null}
              </div>
            ) : null}
            {mode === 'contrast' ? (
              <div style={{ padding: 24, borderRadius: 16, background: bg, color: fg, border: '1px solid var(--border)' }} data-testid="color-contrast-preview">
                <h3 style={{ marginTop: 0 }}>Sample body text</h3>
                <p>Contrast ratio: {ratio ? `${ratio.toFixed(2)}:1` : '—'}</p>
                <div className="hero-button-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                  <StatusBadge tone={grade.aaBody ? 'green' : 'danger'}>{grade.aaBody ? 'AA body pass' : 'AA body fail'}</StatusBadge>
                  <StatusBadge tone={grade.aaLarge ? 'green' : 'danger'}>{grade.aaLarge ? 'AA large pass' : 'AA large fail'}</StatusBadge>
                  <StatusBadge tone={grade.aaaBody ? 'green' : 'neutral'}>{grade.aaaBody ? 'AAA body pass' : 'AAA body fail'}</StatusBadge>
                </div>
              </div>
            ) : null}
            {mode === 'gradient' ? (
              <div style={{ height: 200, borderRadius: 16, border: '1px solid var(--border)', background: `linear-gradient(135deg, ${g1}, ${g2})` }} data-testid="color-gradient-preview" />
            ) : null}
            {mode === 'image' ? (
              <>
                <FilePicker accept="image/*" multiple={false} files={files} onChange={setFiles} disabled={busy || extracting} title="Drop image for palette" />
                {extracting ? <p className="helper-note">Sampling image pixels…</p> : null}
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
              <p className="workspace-description" style={{ margin: 0 }}>
                Palette is extracted from image pixels in the browser. Optional Sharp jobs optimize or strip metadata.
              </p>
            ) : (
              <p className="helper-note" style={{ marginTop: 12 }}>Browser-only color tools — no server round-trip for picker/contrast/gradient.</p>
            )}
            <div className="hero-button-row" style={{ marginTop: 12, flexWrap: 'wrap' }} data-testid="color-export-actions">
              <SecondaryButton size="sm" icon="copy" onClick={() => doCopy('Hex', hex)} disabled={!hex}>Copy hex</SecondaryButton>
              <SecondaryButton size="sm" icon="copy" onClick={() => doCopy('CSS vars', paletteToCssVars(activePalette))} disabled={!activePalette.length}>Copy CSS</SecondaryButton>
              <SecondaryButton size="sm" icon="download" onClick={exportJson} disabled={!activePalette.length}>JSON</SecondaryButton>
              <SecondaryButton size="sm" icon="download" onClick={exportCss} disabled={!activePalette.length}>CSS</SecondaryButton>
              <SecondaryButton size="sm" icon="download" onClick={exportSvg} disabled={!activePalette.length}>SVG</SecondaryButton>
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{MODES.find((m) => m.id === mode)?.label}</strong>
              <span>
                {mode === 'image'
                  ? (busy ? `${progress}%` : extracting ? 'Sampling' : `${imagePalette.length} colors`)
                  : mode === 'contrast' && ratio
                    ? `${ratio.toFixed(2)}:1`
                    : `${activePalette.length || 1} colors`}
              </span>
            </div>
            <div className="hero-button-row">
              {mode === 'image' ? (
                <>
                  {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
                  <SecondaryButton icon="image" onClick={() => runImage('optimize')} disabled={busy || !files.length}>Optimize</SecondaryButton>
                  <PrimaryButton icon="palette" onClick={() => {
                    if (files[0]) {
                      setExtracting(true);
                      extractPaletteFromFile(files[0], { maxColors: 6 })
                        .then((colors) => { setImagePalette(colors); if (colors[0]) setHex(colors[0]); notify?.(`Extracted ${colors.length} colors`); })
                        .catch((e) => notify?.(e?.message || 'Extract failed'))
                        .finally(() => setExtracting(false));
                    } else notify?.('Choose an image first');
                  }} disabled={extracting || !files.length} busy={extracting}>
                    Extract palette
                  </PrimaryButton>
                </>
              ) : (
                <PrimaryButton
                  icon="copy"
                  onClick={() => doCopy(
                    mode === 'gradient' ? 'Gradient CSS' : mode === 'contrast' ? 'Contrast pair' : 'Palette',
                    mode === 'gradient'
                      ? `linear-gradient(135deg, ${g1}, ${g2})`
                      : mode === 'contrast'
                        ? `fg: ${fg}; bg: ${bg}; ratio: ${ratio ? ratio.toFixed(2) : '—'}`
                        : activePalette.join(', '),
                  )}
                >
                  Copy result
                </PrimaryButton>
              )}
            </div>
          </>
        )}
      />
    </div>
  );
}

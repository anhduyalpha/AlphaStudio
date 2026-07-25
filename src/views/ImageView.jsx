import React, { useEffect, useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, TextField, Panel, ToggleRow } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave } from '../components/Workbench';
import { SegmentedControl, CompareSlider, FileRow } from '../components/StudioPrimitives';
import CropSelector from '../components/image/CropSelector';
import useJobRunner from '../hooks/useJobRunner';
import useJobPreviewUrl from '../hooks/useJobPreviewUrl';
import { buildCropJobOptions, clampCropRect, defaultCropRect } from '../lib/imageCrop';

const OPS = [
  { id: 'optimize', label: 'Optimize' },
  { id: 'resize', label: 'Resize' },
  { id: 'crop', label: 'Crop' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'convert', label: 'Convert' },
  { id: 'compress', label: 'Compress' },
  { id: 'strip-metadata', label: 'Strip metadata' },
];

export default function ImageView({ notify }) {
  const [files, setFiles] = useState([]);
  const [operation, setOperation] = useState('optimize');
  const [format, setFormat] = useState('webp');
  const [width, setWidth] = useState('1280');
  const [height, setHeight] = useState('');
  const [angle, setAngle] = useState('90');
  const [quality, setQuality] = useState('80');
  const [stripMeta, setStripMeta] = useState(false);
  const [dims, setDims] = useState({ w: null, h: null });
  const [crop, setCrop] = useState(null);
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);

  const previewUrl = useMemo(() => (files[0] ? URL.createObjectURL(files[0]) : null), [files]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  useEffect(() => {
    if (!previewUrl) {
      setDims({ w: null, h: null });
      setCrop(null);
      return undefined;
    }
    const img = new Image();
    img.onload = () => {
      const next = { w: img.naturalWidth, h: img.naturalHeight };
      setDims(next);
      setCrop(defaultCropRect({ naturalWidth: next.w, naturalHeight: next.h }));
    };
    img.src = previewUrl;
    return undefined;
  }, [previewUrl]);

  const { url: resultPreview, loading: resultLoading } = useJobPreviewUrl(job, { enabled: true });

  const onCropChange = (next) => {
    if (!dims.w || !dims.h) return;
    const clamped = clampCropRect(next, { naturalWidth: dims.w, naturalHeight: dims.h });
    setCrop(clamped);
  };

  const onCropField = (key) => (e) => {
    if (!dims.w || !dims.h || !crop) return;
    const n = Number(e.target.value);
    if (!Number.isFinite(n)) return;
    onCropChange({ ...crop, [key]: n });
  };

  const start = async () => {
    if (!files.length) {
      notify('Choose an image first');
      return;
    }
    if (operation === 'crop') {
      if (!crop || crop.width < 1 || crop.height < 1) {
        notify('Set a valid crop region first');
        return;
      }
    }
    const options = buildCropJobOptions({
      operation,
      format,
      quality,
      angle,
      stripMeta,
      width,
      height,
      crop: operation === 'crop' ? crop : null,
    });
    try {
      await run('image', { files: files.slice(0, 1), options, autoDownload: false });
    } catch {
      /* handled */
    }
  };

  const showResizeFields = operation === 'resize';
  const showCropFields = operation === 'crop';
  const showAngle = operation === 'rotate';
  const showFormat = operation !== 'strip-metadata';

  return (
    <div className="view-stack image-canvas-workspace family-image" data-testid="image-canvas-workspace">
      <WorkspaceHeader
        meta="Core tools / Image Lab"
        title="Image canvas"
        description="Source and result previews dominate. Crop uses an interactive selection mapped to natural pixels."
        family="image"
        status={<StatusBadge tone="green" status={busy ? 'converting' : 'completed'} live={busy}>{busy ? status || 'Running' : operation}</StatusBadge>}
      />

      <SegmentedControl
        label="Image operations"
        value={operation}
        onChange={setOperation}
        options={OPS.map((o) => ({ id: o.id, label: o.label }))}
      />

      <WorkbenchLayout
        family="image"
        stage={(
          <Panel title="Canvas" actions={<StatusBadge tone="green">Sharp</StatusBadge>}>
            <FilePicker accept="image/*" multiple={false} files={files} onChange={setFiles} disabled={busy} />
            {files[0] ? (
              <FileRow
                name={files[0].name}
                meta={[
                  files[0].type || 'image',
                  dims.w ? `${dims.w}×${dims.h}` : null,
                  `${(files[0].size / 1024).toFixed(1)} KB`,
                ].filter(Boolean).join(' · ')}
                status="ready"
              />
            ) : null}
            {previewUrl && operation === 'crop' && !resultPreview ? (
              <CropSelector
                src={previewUrl}
                crop={crop}
                onChange={onCropChange}
                disabled={busy}
                naturalWidth={dims.w || undefined}
                naturalHeight={dims.h || undefined}
              />
            ) : null}
            {previewUrl && operation !== 'crop' && !resultPreview ? (
              <div className="image-compare" style={{ marginTop: 16 }}>
                <div className="image-swatch original">
                  <img src={previewUrl} alt="Original preview" style={{ maxWidth: '100%', borderRadius: 12 }} />
                </div>
              </div>
            ) : null}
            {previewUrl && resultPreview ? (
              <CompareSlider beforeSrc={previewUrl} afterSrc={resultPreview} beforeLabel="Source" afterLabel="Result" />
            ) : null}
            {resultLoading ? <p className="helper-note">Loading result preview…</p> : null}
            {!previewUrl ? (
              <EmptyState type="noResults" compact title="No image selected" description="Drop an image to preview dimensions and transforms." />
            ) : null}
            {busy ? <ProgressWave value={progress} label="Image job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title={`${OPS.find((o) => o.id === operation)?.label || 'Transform'} options`}>
            <div className="form-grid">
              {showFormat ? (
                <SelectField label="Output format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="webp">WebP</option>
                  <option value="png">PNG</option>
                  <option value="jpeg">JPEG</option>
                  <option value="avif">AVIF</option>
                </SelectField>
              ) : null}
              {showResizeFields ? (
                <>
                  <TextField label="Width" value={width} onChange={(e) => setWidth(e.target.value)} />
                  <TextField label="Height" value={height} onChange={(e) => setHeight(e.target.value)} />
                </>
              ) : null}
              {showCropFields && crop ? (
                <>
                  <TextField label="Left" value={String(crop.left)} onChange={onCropField('left')} />
                  <TextField label="Top" value={String(crop.top)} onChange={onCropField('top')} />
                  <TextField label="Crop width" value={String(crop.width)} onChange={onCropField('width')} />
                  <TextField label="Crop height" value={String(crop.height)} onChange={onCropField('height')} />
                </>
              ) : null}
              {showAngle ? (
                <SelectField label="Angle" value={angle} onChange={(e) => setAngle(e.target.value)}>
                  <option value="90">90°</option>
                  <option value="180">180°</option>
                  <option value="270">270°</option>
                </SelectField>
              ) : null}
              {operation === 'compress' || operation === 'optimize' || operation === 'convert' ? (
                <TextField label="Quality (1–100)" value={quality} onChange={(e) => setQuality(e.target.value)} />
              ) : null}
            </div>
            {operation !== 'strip-metadata' ? (
              <div className="toggle-stack" style={{ marginTop: 12 }}>
                <ToggleRow
                  title="Strip metadata"
                  description="Remove EXIF when the encoder allows."
                  checked={stripMeta}
                  onChange={(e) => setStripMeta(e.target.checked)}
                />
              </div>
            ) : (
              <p className="workspace-description" style={{ marginTop: 12 }}>Creates a clean copy without metadata.</p>
            )}
            <div className="preview-info-list" style={{ marginTop: 12 }}>
              <div><span>Source size</span><strong>{dims.w ? `${dims.w}×${dims.h}` : '—'}</strong></div>
              <div><span>Operation</span><strong>{operation}</strong></div>
              {showCropFields && crop ? (
                <div><span>Crop origin</span><strong>{crop.left}, {crop.top}</strong></div>
              ) : null}
            </div>
          </Panel>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{operation}</strong>
              <span>{files[0]?.name || 'No file'} · {busy ? `${progress}%` : 'Ready'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton icon="image" onClick={start} disabled={busy || !files.length} busy={busy}>Process image</PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}

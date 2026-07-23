import React, { useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import { PrimaryButton, SecondaryButton, SelectField, StatusBadge, TextField, Panel } from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave } from '../components/Workbench';
import useJobRunner from '../hooks/useJobRunner';

const OPS = [
  { id: 'resize', label: 'Resize' },
  { id: 'crop', label: 'Crop' },
  { id: 'rotate', label: 'Rotate' },
  { id: 'convert', label: 'Convert' },
  { id: 'compress', label: 'Compress' },
  { id: 'optimize', label: 'Optimize' },
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
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);

  const start = async () => {
    if (!files.length) {
      notify('Choose an image first');
      return;
    }
    const options = {
      operation,
      format,
      quality: Number(quality) || 80,
      angle: Number(angle) || 90,
      width: width ? Number(width) : undefined,
      height: height ? Number(height) : undefined,
    };
    if (operation === 'crop') {
      options.left = 0;
      options.top = 0;
      options.width = Number(width) || 512;
      options.height = Number(height) || 512;
    }
    try {
      await run('image', { files: files.slice(0, 1), options, autoDownload: false });
    } catch {
      /* handled */
    }
  };

  const previewUrl = files[0] ? URL.createObjectURL(files[0]) : null;

  return (
    <div className="view-stack image-canvas-workspace family-image" data-testid="image-canvas-workspace">
      <WorkspaceHeader
        meta="Core tools / Image Lab"
        title="Image canvas"
        description="Preview is the primary object. Transforms stay in the rail; export runs against the local Sharp pipeline."
        family="image"
        status={<StatusBadge tone="green" status={busy ? 'converting' : 'completed'} live={busy}>{busy ? status || 'Running' : operation}</StatusBadge>}
      />

      <WorkbenchLayout
        family="image"
        stage={(
          <Panel title="Canvas" actions={<StatusBadge tone="green">Sharp</StatusBadge>}>
            <FilePicker accept="image/*" multiple={false} files={files} onChange={setFiles} disabled={busy} />
            {previewUrl ? (
              <div className="image-compare" style={{ marginTop: 16 }}>
                <div className="image-swatch original">
                  <img src={previewUrl} alt="Original preview" style={{ maxWidth: '100%', borderRadius: 12 }} />
                </div>
              </div>
            ) : (
              <EmptyState type="noResults" compact title="No image selected" description="Drop an image to preview and transform." />
            )}
            {busy ? <ProgressWave value={progress} label="Image job" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <Panel title="Transforms">
            <div className="form-grid">
              <SelectField label="Operation" value={operation} onChange={(e) => setOperation(e.target.value)}>
                {OPS.map((op) => <option key={op.id} value={op.id}>{op.label}</option>)}
              </SelectField>
              <SelectField label="Output format" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="webp">WebP</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="avif">AVIF</option>
              </SelectField>
              <TextField label="Width" value={width} onChange={(e) => setWidth(e.target.value)} />
              <TextField label="Height" value={height} onChange={(e) => setHeight(e.target.value)} />
              <TextField label="Angle" value={angle} onChange={(e) => setAngle(e.target.value)} />
              <TextField label="Quality" value={quality} onChange={(e) => setQuality(e.target.value)} />
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
              <PrimaryButton icon="image" onClick={start} disabled={busy} busy={busy}>Process image</PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}

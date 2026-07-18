import React, { useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import { PageIntro, PrimaryButton, SecondaryButton, SelectField, StatusBadge, TextField } from '../components/Common';
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

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Tools / Image Lab"
        title="Resize, convert, and optimize images."
        description="Sharp-powered image operations with real downloads and metadata stripping."
        actions={
          <>
            {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
            <PrimaryButton icon="image" onClick={start} disabled={busy}>
              {busy ? `${progress}%` : 'Process image'}
            </PrimaryButton>
          </>
        }
      />

      <section className="workspace-grid">
        <div className="workspace-primary">
          <article className="surface-card content-card">
            <div className="card-heading">
              <div><p className="eyebrow">Source</p><h3>Image input</h3></div>
              <StatusBadge tone="green">Sharp</StatusBadge>
            </div>
            <FilePicker accept="image/*" multiple={false} files={files} onChange={setFiles} disabled={busy} />
            {files[0] ? (
              <div className="image-compare" style={{ marginTop: 16 }}>
                <div className="image-swatch original">
                  <img src={URL.createObjectURL(files[0])} alt="Original preview" style={{ maxWidth: '100%', borderRadius: 12 }} />
                  <label>Original • {(files[0].size / 1024).toFixed(0)} KB</label>
                </div>
              </div>
            ) : null}
          </article>
          <article className="surface-card content-card">
            <div className="form-grid">
              <SelectField label="Operation" value={operation} onChange={(e) => setOperation(e.target.value)}>
                {OPS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </SelectField>
              <SelectField label="Output format" value={format} onChange={(e) => setFormat(e.target.value)}>
                <option value="webp">WEBP</option>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="avif">AVIF</option>
              </SelectField>
              <TextField label="Width" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="1280" />
              <TextField label="Height" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="auto" />
              <TextField label="Rotate angle" value={angle} onChange={(e) => setAngle(e.target.value)} />
              <TextField label="Quality" value={quality} onChange={(e) => setQuality(e.target.value)} />
            </div>
          </article>
        </div>
        <aside className="workspace-sidebar">
          <article className="surface-card content-card sticky-card">
            <p className="eyebrow">Status</p>
            <h3>{busy ? status : 'Ready'}</h3>
            <div className="summary-list">
              <div><span>Operation</span><strong>{operation}</strong></div>
              <div><span>Progress</span><strong>{busy ? `${progress}%` : '—'}</strong></div>
            </div>
            <PrimaryButton icon="wand" onClick={start} disabled={busy || !files.length}>
              Run
            </PrimaryButton>
          </article>
        </aside>
      </section>
      <JobOutputCard job={job} notify={notify} title="Processed image" />
    </div>
  );
}

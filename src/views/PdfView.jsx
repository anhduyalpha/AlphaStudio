import React, { useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import { PageIntro, PrimaryButton, SecondaryButton, SelectField, StatusBadge, TextField, WorkspaceTabs } from '../components/Common';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';

const OPS = [
  { id: 'merge', label: 'Merge', capability: 'pdf.merge' },
  { id: 'split', label: 'Split', capability: 'pdf.split' },
  { id: 'rotate', label: 'Rotate', capability: 'pdf.rotate' },
  { id: 'reorder', label: 'Reorder', capability: 'pdf.reorder' },
  { id: 'compress', label: 'Structural optimize', capability: 'pdf.compress' },
  { id: 'extract', label: 'Extract', capability: 'pdf.extract' },
  { id: 'from-images', label: 'Images → PDF', capability: 'pdf.from-images' },
  // to-images only listed when capability available (rasterizer)
  { id: 'to-images', label: 'PDF → Images', capability: 'pdf.to-images' },
];

export default function PdfView({ notify }) {
  const [tab, setTab] = useState('Workspace');
  const [files, setFiles] = useState([]);
  const [operation, setOperation] = useState('merge');
  const [pages, setPages] = useState('');
  const [angle, setAngle] = useState('90');
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason, loading: capsLoading } = useCapabilities();

  const visibleOps = OPS.filter((o) => {
    if (o.id === 'to-images') return isAvailable(o.capability) === true;
    return true;
  });
  const opMeta = visibleOps.find((o) => o.id === operation) || visibleOps[0] || OPS[0];
  const available = isAvailable(opMeta.capability);
  const unavailable = available === false || (capsLoading && available == null);

  const start = async () => {
    if (unavailable) {
      notify(`Unavailable: ${reason(opMeta.capability) || opMeta.capability}`);
      return;
    }
    if (!files.length) {
      notify('Choose PDF or image files first');
      return;
    }
    try {
      await run('pdf', {
        files,
        options: {
          operation,
          pages: pages || undefined,
          order: pages || undefined,
          angle: Number(angle) || 90,
        },
        autoDownload: false,
      });
    } catch {
      /* handled */
    }
  };

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Tools / PDF Studio"
        title="A focused workspace for every PDF task."
        description="Merge, split, rotate, reorder, structurally optimize, extract pages, and build PDFs from images via the local API. Unsupported modules stay hidden."
        actions={
          <>
            {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
            <PrimaryButton icon="upload" onClick={start} disabled={busy || unavailable}>
              {unavailable ? 'Unavailable' : busy ? `${progress}%` : 'Run PDF operation'}
            </PrimaryButton>
          </>
        }
      />

      <WorkspaceTabs tabs={['Workspace', 'Batch', 'Export']} active={tab} onChange={setTab} />

      <section className="workspace-grid">
        <div className="workspace-primary">
          <article className="surface-card content-card">
            <div className="card-heading">
              <div><p className="eyebrow">Documents</p><h3>Input files</h3></div>
              <StatusBadge tone="cyan">{files.length} selected</StatusBadge>
            </div>
            <FilePicker
              accept={operation === 'from-images' ? 'image/*' : 'application/pdf,.pdf'}
              files={files}
              onChange={setFiles}
              disabled={busy}
            />
          </article>
          <article className="surface-card content-card">
            <div className="form-grid">
              <SelectField label="Operation" value={opMeta.id} onChange={(e) => setOperation(e.target.value)}>
                {visibleOps.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </SelectField>
              <TextField label="Pages / order (1-based, empty = all; supports 1- open range)" value={pages} onChange={(e) => setPages(e.target.value)} placeholder="all pages, or 1-3,5 or 1-" />
              <SelectField label="Rotate angle" value={angle} onChange={(e) => setAngle(e.target.value)}>
                <option value="90">90°</option>
                <option value="180">180°</option>
                <option value="270">270°</option>
              </SelectField>
            </div>
          </article>
        </div>
        <aside className="workspace-sidebar">
          <article className="surface-card content-card sticky-card">
            <p className="eyebrow">Status</p>
            <h3>{unavailable ? 'Unavailable' : busy ? status : 'Ready'}</h3>
            <div className="summary-list">
              <div><span>Operation</span><strong>{opMeta.label}</strong></div>
              <div><span>Progress</span><strong>{busy ? `${progress}%` : '—'}</strong></div>
              <div><span>Engine</span><strong>pdf-lib</strong></div>
            </div>
            {unavailable ? <p className="helper-note">{reason(opMeta.capability)}</p> : null}
            <PrimaryButton icon="file" onClick={start} disabled={busy || unavailable || !files.length}>
              {unavailable ? 'Unavailable' : 'Process PDF'}
            </PrimaryButton>
          </article>
        </aside>
      </section>
      <JobOutputCard job={job} notify={notify} title="Processed PDF" />
    </div>
  );
}

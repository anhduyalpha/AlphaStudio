import React, { useEffect, useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import {
  PageIntro,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  StatusBadge,
  TextField,
  WorkspaceTabs,
} from '../components/Common';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';
import PdfPageOrganizer from '../components/pdf/PdfPageOrganizer';

/** Operation catalog grouped for the PDF workspace */
const GROUPS = [
  {
    id: 'organize',
    label: 'Organize',
    ops: [
      { id: 'merge', label: 'Merge', capability: 'pdf.merge', engine: 'pdf-lib', multi: true, needsPages: false },
      { id: 'split', label: 'Split', capability: 'pdf.split', engine: 'pdf-lib', needsPages: true, needsSplitMode: true },
      { id: 'reorder', label: 'Reorder', capability: 'pdf.reorder', engine: 'pdf-lib', needsPages: true, needsOrder: true, preview: true },
      { id: 'rotate', label: 'Rotate', capability: 'pdf.rotate', engine: 'pdf-lib', needsPages: true, needsAngle: true, preview: true },
      { id: 'extract', label: 'Extract', capability: 'pdf.extract', engine: 'pdf-lib', needsPages: true, preview: true },
      { id: 'delete-pages', label: 'Delete pages', capability: 'pdf.delete-pages', engine: 'pdf-lib', needsPages: true, preview: true },
      { id: 'duplicate-pages', label: 'Duplicate pages', capability: 'pdf.duplicate-pages', engine: 'pdf-lib', needsPages: true, preview: true },
    ],
  },
  {
    id: 'convert',
    label: 'Convert',
    ops: [
      { id: 'from-images', label: 'Images → PDF', capability: 'pdf.from-images', engine: 'pdf-lib+sharp', images: true, needsPageMode: true },
      { id: 'to-images', label: 'PDF → Images', capability: 'pdf.to-images', engine: 'pdftoppm|mutool|ghostscript', needsPages: true, needsFormat: true, needsQuality: true },
      { id: 'to-text', label: 'PDF → Text', capability: 'pdf.to-text', engine: 'pdftotext|mutool|native', needsOcrToggle: true },
    ],
  },
  {
    id: 'optimize',
    label: 'Optimize',
    ops: [
      { id: 'compress-structural', label: 'Structural optimization', capability: 'pdf.compress.structural', engine: 'pdf-lib', needsQuality: true },
      { id: 'compress-advanced', label: 'Advanced compression', capability: 'pdf.compress.advanced', engine: 'ghostscript|qpdf', needsQuality: true },
      { id: 'repair', label: 'Repair', capability: 'pdf.repair', engine: 'qpdf|ghostscript' },
    ],
  },
  {
    id: 'analyze',
    label: 'Analyze',
    ops: [
      { id: 'inspect', label: 'Inspect', capability: 'pdf.inspect', engine: 'pdf-lib' },
      { id: 'ocr', label: 'OCR', capability: 'pdf.ocr', engine: 'tesseract', needsOcrLang: true },
    ],
  },
];

const ALL_OPS = GROUPS.flatMap((g) => g.ops.map((o) => ({ ...o, group: g.id, groupLabel: g.label })));

function expectedEngine(op, caps) {
  if (!op) return '—';
  const tool = caps?.tools?.find((t) => t.id === op.capability);
  if (tool?.engine) return tool.engine;
  return op.engine || '—';
}

export default function PdfView({ notify }) {
  const [tab, setTab] = useState('Workspace');
  const [files, setFiles] = useState([]);
  const [operation, setOperation] = useState('merge');
  const [pages, setPages] = useState('');
  const [angle, setAngle] = useState('90');
  const [format, setFormat] = useState('png');
  const [quality, setQuality] = useState('balanced');
  const [splitMode, setSplitMode] = useState('every-page');
  const [everyN, setEveryN] = useState('2');
  const [splitGroups, setSplitGroups] = useState('1-2;3-4');
  const [ocr, setOcr] = useState(false);
  const [ocrLang, setOcrLang] = useState('eng');
  const [pageSize, setPageSize] = useState('fit-to-image');
  const [fit, setFit] = useState('contain');
  const [margin, setMargin] = useState('0');
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [insertAt, setInsertAt] = useState('');
  const [editPlan, setEditPlan] = useState(null);
  const [lastOutput, setLastOutput] = useState(null);
  const [inspectData, setInspectData] = useState(null);

  // autoResume: re-reads alphastudio.pdf.activeJobId and reattaches SSE/poll (no new job)
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify, {
    storageKey: 'alphastudio.pdf.activeJobId',
    autoResume: true,
  });
  const { isAvailable, reason, loading: capsLoading, caps } = useCapabilities();

  useEffect(() => {
    if (job?.status === 'completed') {
      setLastOutput(job);
      setFiles([]);
      // Parse inspect JSON meta if present
      if (job.meta && (operation === 'inspect' || (job.meta.pageCount != null && job.meta.checksum))) {
        setInspectData(job.meta);
      }
    }
  }, [job?.status, job, operation]);

  const visibleOps = useMemo(() => {
    return ALL_OPS.filter((o) => {
      const avail = isAvailable(o.capability);
      // Always list bundled ops; hide unavailable optional ones from primary list but show with reason
      if (o.id === 'to-images' || o.id === 'ocr' || o.id === 'compress-advanced' || o.id === 'repair') {
        return avail === true || avail === false; // show both, disabled if false
      }
      return true;
    });
  }, [isAvailable, capsLoading]);

  const opMeta = visibleOps.find((o) => o.id === operation) || visibleOps[0] || ALL_OPS[0];
  const available = isAvailable(opMeta.capability);
  const unavailable = available === false;
  const engineLabel =
    (job?.meta && job.meta.engine) || expectedEngine(opMeta, caps);

  const validateClient = () => {
    if (!files.length) return 'Choose PDF or image files first';
    if (opMeta.images) {
      const bad = files.find((f) => f.type && !String(f.type).startsWith('image/') && !/\.(png|jpe?g|webp|tiff?|gif|bmp)$/i.test(f.name || ''));
      if (bad) return 'Images → PDF requires image files';
    } else if (operation !== 'from-images') {
      const bad = files.find((f) => f.type === 'application/pdf' ? false : f.name && !/\.pdf$/i.test(f.name) && f.type && f.type !== 'application/pdf');
      // soft check
      void bad;
    }
    if (opMeta.needsPages && (operation === 'extract' || operation === 'delete-pages' || operation === 'duplicate-pages')) {
      if (!pages.trim() && !editPlan?.pages) return 'Page selection is required for this operation';
    }
    if (operation === 'reorder' && !pages.trim() && !editPlan?.order) {
      return 'Page order is required (e.g. 3,1,2)';
    }
    if (operation === 'merge' && files.length < 1) return 'Add at least one PDF';
    if (operation === 'split' && splitMode === 'groups' && !splitGroups.trim()) {
      return 'Enter custom groups (semicolon-separated page specs, e.g. 1-2;3;4-5)';
    }
    return null;
  };

  const jobSummary = useMemo(() => {
    const parts = [`${opMeta.groupLabel} → ${opMeta.label}`];
    if (files.length) parts.push(`${files.length} file(s)`);
    if (pages) parts.push(`pages: ${pages}`);
    if (opMeta.needsAngle) parts.push(`${angle}°`);
    if (opMeta.needsFormat) parts.push(format);
    if (opMeta.needsQuality) parts.push(`quality: ${quality}`);
    if (opMeta.needsOcrToggle && ocr) parts.push(`OCR (${ocrLang})`);
    if (opMeta.needsOcrLang) parts.push(`lang: ${ocrLang}`);
    if (operation === 'split') parts.push(`mode: ${splitMode}`);
    if (operation === 'split' && splitMode === 'groups') parts.push(`groups: ${splitGroups}`);
    if (operation === 'duplicate-pages' && insertAt !== '') parts.push(`insertAt: ${insertAt}`);
    return parts.join(' · ');
  }, [opMeta, files.length, pages, angle, format, quality, ocr, ocrLang, operation, splitMode, splitGroups, insertAt]);

  const start = async () => {
    if (unavailable) {
      notify(`Unavailable: ${reason(opMeta.capability) || opMeta.capability}`);
      return;
    }
    const err = validateClient();
    if (err) {
      notify(err);
      return;
    }
    try {
      const options = {
        operation,
        pages: editPlan?.pages || pages || undefined,
        order: editPlan?.order || pages || undefined,
        angle: Number(angle) || 90,
        format,
        quality,
        splitMode: operation === 'split' ? splitMode : undefined,
        everyN: operation === 'split' && splitMode === 'every-n' ? Number(everyN) || 2 : undefined,
        groups: operation === 'split' && splitMode === 'groups' ? splitGroups : undefined,
        ocr: operation === 'to-text' ? ocr : operation === 'ocr' ? true : undefined,
        ocrLang: opMeta.needsOcrLang || ocr ? ocrLang : undefined,
        pageSize: operation === 'from-images' ? pageSize : undefined,
        fit: operation === 'from-images' ? fit : undefined,
        margin: operation === 'from-images' ? Number(margin) || 0 : undefined,
        allowDuplicates: operation === 'reorder' ? allowDuplicates : undefined,
        // 0-based insertion index for duplicate-pages (empty = after each source page)
        insertAt:
          operation === 'duplicate-pages' && insertAt !== '' && Number.isFinite(Number(insertAt))
            ? Number(insertAt)
            : undefined,
        compressMode:
          operation === 'compress-advanced'
            ? 'advanced'
            : operation === 'compress-structural'
              ? 'structural'
              : undefined,
      };
      // Strip undefined
      Object.keys(options).forEach((k) => options[k] === undefined && delete options[k]);

      await run('pdf', {
        files,
        options,
        autoDownload: false,
      });
    } catch {
      /* handled by hook */
    }
  };

  const displayJob = job || lastOutput;

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow="Tools / PDF Studio"
        title="Production-ready PDF workspace"
        description="Organize, convert, optimize, and analyze PDFs via the local worker pipeline. Only supported operations are enabled for this machine."
        actions={
          <>
            {busy ? (
              <SecondaryButton icon="close" onClick={cancel}>
                Cancel
              </SecondaryButton>
            ) : null}
            <PrimaryButton icon="upload" onClick={start} disabled={busy || unavailable}>
              {unavailable ? 'Unavailable' : busy ? `${progress}%` : 'Run PDF operation'}
            </PrimaryButton>
          </>
        }
      />

      <WorkspaceTabs tabs={['Workspace', 'Preview', 'Export']} active={tab} onChange={setTab} />

      {tab === 'Workspace' || tab === 'Preview' ? (
        <section className="workspace-grid">
          <div className="workspace-primary">
            <article className="surface-card content-card">
              <div className="card-heading">
                <div>
                  <p className="eyebrow">Documents</p>
                  <h3>Input files</h3>
                </div>
                <StatusBadge tone="cyan">{files.length} selected</StatusBadge>
              </div>
              <FilePicker
                accept={opMeta.images ? 'image/*' : 'application/pdf,.pdf'}
                files={files}
                onChange={setFiles}
                disabled={busy}
                multiple={opMeta.multi || opMeta.images || operation === 'merge'}
              />
            </article>

            <article className="surface-card content-card">
              <div className="form-grid">
                <SelectField
                  label="Category"
                  value={opMeta.group}
                  onChange={(e) => {
                    const first = ALL_OPS.find((o) => o.group === e.target.value);
                    if (first) setOperation(first.id);
                  }}
                >
                  {GROUPS.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.label}
                    </option>
                  ))}
                </SelectField>

                <SelectField label="Operation" value={opMeta.id} onChange={(e) => setOperation(e.target.value)}>
                  {GROUPS.find((g) => g.id === opMeta.group)?.ops.map((o) => {
                    const avail = isAvailable(o.capability);
                    return (
                      <option key={o.id} value={o.id} disabled={avail === false}>
                        {o.label}
                        {avail === false ? ' (unavailable)' : ''}
                      </option>
                    );
                  })}
                </SelectField>

                {opMeta.needsPages || opMeta.needsOrder ? (
                  <TextField
                    label="Pages / order (1-based)"
                    value={pages}
                    onChange={(e) => setPages(e.target.value)}
                    placeholder="e.g. all, odd, 1-3,5, 1-, last"
                  />
                ) : null}

                {opMeta.needsAngle ? (
                  <SelectField label="Rotate angle" value={angle} onChange={(e) => setAngle(e.target.value)}>
                    <option value="90">90°</option>
                    <option value="180">180°</option>
                    <option value="270">270°</option>
                  </SelectField>
                ) : null}

                {opMeta.needsSplitMode ? (
                  <>
                    <SelectField label="Split mode" value={splitMode} onChange={(e) => setSplitMode(e.target.value)}>
                      <option value="every-page">Every page</option>
                      <option value="ranges">Selected ranges</option>
                      <option value="every-n">Every N pages</option>
                      <option value="groups">Custom groups</option>
                    </SelectField>
                    {splitMode === 'every-n' ? (
                      <TextField label="Pages per part (N)" value={everyN} onChange={(e) => setEveryN(e.target.value)} />
                    ) : null}
                    {splitMode === 'groups' ? (
                      <TextField
                        label="Groups (semicolon-separated page specs)"
                        value={splitGroups}
                        onChange={(e) => setSplitGroups(e.target.value)}
                        placeholder="1-2;3;4-6"
                      />
                    ) : null}
                  </>
                ) : null}

                {operation === 'duplicate-pages' ? (
                  <TextField
                    label="Insert copies at position (0-based, empty = after each original)"
                    value={insertAt}
                    onChange={(e) => setInsertAt(e.target.value)}
                    placeholder="e.g. 0 for start, 2 for after page 2"
                  />
                ) : null}

                {opMeta.needsFormat ? (
                  <SelectField label="Image format" value={format} onChange={(e) => setFormat(e.target.value)}>
                    <option value="png">PNG</option>
                    <option value="jpeg">JPEG</option>
                  </SelectField>
                ) : null}

                {opMeta.needsQuality ? (
                  <SelectField label="Quality preset" value={quality} onChange={(e) => setQuality(e.target.value)}>
                    <option value="fast">Fast</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High</option>
                  </SelectField>
                ) : null}

                {opMeta.needsOcrToggle ? (
                  <SelectField label="OCR fallback" value={ocr ? 'yes' : 'no'} onChange={(e) => setOcr(e.target.value === 'yes')}>
                    <option value="no">Native text only</option>
                    <option value="yes">Enable OCR if scanned</option>
                  </SelectField>
                ) : null}

                {opMeta.needsOcrLang || (opMeta.needsOcrToggle && ocr) ? (
                  <TextField
                    label="OCR language"
                    value={ocrLang}
                    onChange={(e) => setOcrLang(e.target.value)}
                    placeholder="eng, vie, eng+vie"
                  />
                ) : null}

                {opMeta.needsPageMode ? (
                  <>
                    <SelectField label="Page size" value={pageSize} onChange={(e) => setPageSize(e.target.value)}>
                      <option value="fit-to-image">Fit to image</option>
                      <option value="a4">A4</option>
                      <option value="letter">Letter</option>
                      <option value="original">Original image size</option>
                    </SelectField>
                    <SelectField label="Fit mode" value={fit} onChange={(e) => setFit(e.target.value)}>
                      <option value="contain">Contain</option>
                      <option value="cover">Cover</option>
                      <option value="stretch">Stretch</option>
                    </SelectField>
                    <TextField label="Margin (pt)" value={margin} onChange={(e) => setMargin(e.target.value)} />
                  </>
                ) : null}

                {operation === 'reorder' ? (
                  <SelectField
                    label="Allow duplicate pages"
                    value={allowDuplicates ? 'yes' : 'no'}
                    onChange={(e) => setAllowDuplicates(e.target.value === 'yes')}
                  >
                    <option value="no">No (full permutation)</option>
                    <option value="yes">Yes</option>
                  </SelectField>
                ) : null}
              </div>
              <p className="helper-note" style={{ marginTop: '0.75rem' }}>
                Job: {jobSummary}
              </p>
            </article>

            {tab === 'Preview' && opMeta.preview && files[0] ? (
              <PdfPageOrganizer
                file={files[0]}
                operation={operation}
                pages={pages}
                onPagesChange={setPages}
                onPlanChange={setEditPlan}
                angle={angle}
                onAngleChange={setAngle}
                disabled={busy}
              />
            ) : null}

            {inspectData && operation === 'inspect' ? (
              <article className="surface-card content-card">
                <div className="card-heading">
                  <div>
                    <p className="eyebrow">Inspection</p>
                    <h3>{inspectData.filename || 'Document'}</h3>
                  </div>
                </div>
                <div className="summary-list">
                  <div>
                    <span>Pages</span>
                    <strong>{inspectData.pageCount ?? '—'}</strong>
                  </div>
                  <div>
                    <span>Size</span>
                    <strong>{inspectData.size != null ? `${Math.round(inspectData.size / 1024)} KB` : '—'}</strong>
                  </div>
                  <div>
                    <span>Encrypted</span>
                    <strong>{inspectData.encryption?.encrypted ? 'Yes' : 'No'}</strong>
                  </div>
                  <div>
                    <span>Scanned likely</span>
                    <strong>{inspectData.scannedLikely ? 'Yes' : 'No'}</strong>
                  </div>
                  <div>
                    <span>PDF version</span>
                    <strong>{inspectData.pdfVersion || '—'}</strong>
                  </div>
                  <div>
                    <span>Checksum</span>
                    <strong style={{ fontSize: '0.7rem', wordBreak: 'break-all' }}>
                      {inspectData.checksum ? String(inspectData.checksum).slice(0, 16) + '…' : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>Engine</span>
                    <strong>{inspectData.engine || 'pdf-lib'}</strong>
                  </div>
                </div>
                {Array.isArray(inspectData.warnings) && inspectData.warnings.length ? (
                  <ul className="helper-note">
                    {inspectData.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : null}
              </article>
            ) : null}
          </div>

          <aside className="workspace-sidebar">
            <article className="surface-card content-card sticky-card">
              <p className="eyebrow">Status</p>
              <h3>{unavailable ? 'Unavailable' : busy ? status : 'Ready'}</h3>
              <div className="summary-list">
                <div>
                  <span>Operation</span>
                  <strong>{opMeta.label}</strong>
                </div>
                <div>
                  <span>Progress</span>
                  <strong>{busy ? `${progress}%` : '—'}</strong>
                </div>
                <div>
                  <span>Engine</span>
                  <strong>{engineLabel}</strong>
                </div>
                <div>
                  <span>Group</span>
                  <strong>{opMeta.groupLabel}</strong>
                </div>
              </div>
              {unavailable ? <p className="helper-note">{reason(opMeta.capability)}</p> : null}
              {capsLoading ? <p className="helper-note">Detecting tools…</p> : null}
              <PrimaryButton icon="file" onClick={start} disabled={busy || unavailable || !files.length}>
                {unavailable ? 'Unavailable' : busy ? 'Processing…' : 'Process PDF'}
              </PrimaryButton>
            </article>
          </aside>
        </section>
      ) : null}

      {tab === 'Export' ? (
        <section className="workspace-grid">
          <article className="surface-card content-card">
            <p className="eyebrow">Export</p>
            <h3>Last output</h3>
            <p className="helper-note">
              Completed jobs stay available for download. Switching tabs does not cancel running jobs.
            </p>
          </article>
        </section>
      ) : null}

      <JobOutputCard job={displayJob} notify={notify} title="Processed PDF" />
    </div>
  );
}

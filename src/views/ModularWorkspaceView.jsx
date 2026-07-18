import React, { useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import {
  FeatureButton,
  IllustrationCard,
  PageIntro,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  StatusBadge,
  TextField,
  ToggleRow,
  WorkspaceTabs,
} from '../components/Common';
import useJobRunner from '../hooks/useJobRunner';
import useCapabilities from '../hooks/useCapabilities';

/** Map feature titles to backend job type + operation */
function resolveJob(config, featureTitle) {
  const feature = (config.features || []).find((f) => f.title === featureTitle);
  const tool = feature?.jobType || config.jobType || config.id || 'converter';
  const operation = feature?.operation || config.defaultOperation || 'run';
  const capability = feature?.capability || config.capability;
  return { type: tool, operation, capability, feature };
}

export default function ModularWorkspaceView({ config, notify }) {
  const [activeTab, setActiveTab] = useState(config.tabs[0]);
  const [activeFeature, setActiveFeature] = useState(config.features[0].title);
  const [files, setFiles] = useState([]);
  const [outputName, setOutputName] = useState('alphastudio-output');
  const [preset, setPreset] = useState('balanced');
  const [preserveMeta, setPreserveMeta] = useState(true);
  const [expectedDigest, setExpectedDigest] = useState('');
  const { busy, progress, status, job, run, cancel } = useJobRunner(notify);
  const { isAvailable, reason, loading: capsLoading } = useCapabilities();

  const currentFeature = useMemo(
    () => config.features.find((feature) => feature.title === activeFeature) || config.features[0],
    [activeFeature, config.features],
  );

  const jobSpec = resolveJob(config, activeFeature);
  // Client-only features: no server job / no capability gate required
  const isClientOnly = Boolean(currentFeature.clientOnly);
  // Treat unknown capability load as disabled until loaded (no race enable)
  const capOk = isClientOnly
    ? true
    : jobSpec.capability == null
      ? true
      : capsLoading
        ? null
        : isAvailable(jobSpec.capability);
  const unavailable = !isClientOnly && (capOk === false || capOk === null);

  const start = async () => {
    if (isClientOnly) {
      notify(currentFeature.clientMessage || 'This action runs entirely in your browser — no server job.');
      return;
    }
    if (unavailable) {
      notify(`Unavailable: ${reason(jobSpec.capability) || jobSpec.capability || 'loading capabilities…'}`);
      return;
    }
    // Never map OCR to cleanup — hard block
    if (jobSpec.capability === 'text.ocr' || currentFeature.operation === 'ocr') {
      notify('OCR is not available: no OCR engine is bundled.');
      return;
    }
    if (currentFeature.requiresFiles !== false && files.length === 0 && !currentFeature.allowEmpty) {
      notify('Add at least one file first');
      return;
    }
    if (jobSpec.operation === 'compare') {
      const expected = (expectedDigest || currentFeature.options?.expected || '').toString().trim();
      if (!/^[a-fA-F0-9]{32,128}$/.test(expected)) {
        notify('Enter a valid expected checksum (hex digest, 32–128 chars).');
        return;
      }
    }
    // Archive extract: always auto-detect format from magic+extension
    const isExtract = jobSpec.operation === 'extract';
    const format = isExtract
      ? 'auto'
      : currentFeature.format || config.defaultFormat;
    try {
      await run(jobSpec.type, {
        files,
        options: {
          operation: jobSpec.operation,
          format,
          quality: preset,
          outputName,
          stripMetadata: !preserveMeta,
          preserveMetadata: preserveMeta,
          ...(currentFeature.options || {}),
          ...(config.extraOptions || {}),
          ...(jobSpec.operation === 'compare'
            ? { expected: expectedDigest.trim().toLowerCase(), algorithm: currentFeature.options?.algorithm || 'sha256' }
            : {}),
        },
        autoDownload: false,
      });
    } catch {
      /* notify handled in hook */
    }
  };

  return (
    <div className="view-stack">
      <PageIntro
        eyebrow={config.eyebrow}
        title={config.title}
        description={config.description}
        actions={
          <>
            <SecondaryButton icon="refresh" onClick={() => { setFiles([]); notify('Workspace reset.'); }} disabled={busy}>
              Reset
            </SecondaryButton>
            {busy ? (
              <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton>
            ) : null}
            <PrimaryButton
              icon={unavailable ? 'lock' : config.primaryIcon || 'wand'}
              onClick={start}
              disabled={busy || unavailable}
            >
              {unavailable ? 'Unavailable' : busy ? `${progress}%` : config.primaryAction}
            </PrimaryButton>
          </>
        }
      />

      <WorkspaceTabs tabs={config.tabs} active={activeTab} onChange={setActiveTab} />

      <section className="module-overview-grid">
        <IllustrationCard
          src={config.art}
          alt={`${config.title} SVG illustration`}
          eyebrow={`${activeTab} mode`}
          title={currentFeature.title}
          description={currentFeature.description}
        />

        <article className="surface-card content-card module-feature-panel">
          <div className="card-heading">
            <div><p className="eyebrow">Feature launcher</p><h3>Choose an operation</h3></div>
            <StatusBadge tone={config.tone || 'cyan'}>{config.features.length} actions</StatusBadge>
          </div>
          <div className="feature-action-grid">
            {config.features.map((feature) => (
              <FeatureButton
                key={feature.title}
                icon={feature.icon}
                title={feature.title}
                description={feature.short}
                active={feature.title === activeFeature}
                onClick={() => setActiveFeature(feature.title)}
              />
            ))}
          </div>
        </article>
      </section>

      <section className="module-workspace-grid">
        <article className="surface-card content-card">
          <div className="card-heading">
            <div><p className="eyebrow">Input</p><h3>{currentFeature.title}</h3></div>
          </div>
          <FilePicker
            title={currentFeature.dropTitle || 'Drop source files here'}
            subtitle={currentFeature.dropSubtitle || 'Browse from your computer or drag files into this panel'}
            accept={currentFeature.accept || config.accept}
            multiple={currentFeature.multiple !== false}
            files={files}
            onChange={setFiles}
            disabled={busy}
          />
          <div className="form-grid compact-form-grid">
            <SelectField label="Processing preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
              <option value="balanced">Balanced</option>
              <option value="max">Maximum quality</option>
              <option value="small">Smallest output</option>
            </SelectField>
            <SelectField label="Output mode" value="local">
              <option value="local">Local export</option>
            </SelectField>
            <TextField label="Output name" placeholder="alphastudio-output" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
            {jobSpec.operation === 'compare' ? (
              <TextField
                label="Expected checksum (hex)"
                placeholder="e.g. sha256 hex digest"
                value={expectedDigest}
                onChange={(e) => setExpectedDigest(e.target.value)}
              />
            ) : (
              <SelectField label="Conflict handling" value="rename">
                <option value="rename">Rename automatically</option>
              </SelectField>
            )}
          </div>
          <div className="toggle-stack compact-toggle-stack">
            <ToggleRow
              title="Preserve metadata"
              description="Keep supported source metadata in the output when possible."
              checked={preserveMeta}
              onChange={(e) => setPreserveMeta(e.target.checked)}
            />
            <ToggleRow
              title="Keep result in workspace"
              description="Show the finished file below and download only when you choose."
              checked
              disabled
            />
          </div>
        </article>

        <aside className="surface-card content-card module-preview-panel">
          <div className="card-heading">
            <div><p className="eyebrow">Preview</p><h3>Output summary</h3></div>
            <StatusBadge status={unavailable ? 'unavailable' : busy ? 'converting' : 'completed'} tone={unavailable ? 'neutral' : busy ? 'cyan' : 'green'} live={busy}>
              {unavailable ? 'Unavailable' : busy ? status || 'Running' : 'Ready'}
            </StatusBadge>
          </div>
          {unavailable ? (
            <EmptyState
              type="toolsMissing"
              compact
              description={reason(jobSpec.capability) || 'The required local capability is not available.'}
            />
          ) : (
            <div className="module-preview-art"><img src={config.art} alt="" width="640" height="400" /></div>
          )}
          <div className="preview-info-list">
            <div><span>Operation</span><strong>{currentFeature.title}</strong></div>
            <div><span>Workspace tab</span><strong>{activeTab}</strong></div>
            <div><span>Files</span><strong>{files.length}</strong></div>
            <div><span>Backend engine</span><strong>{unavailable ? 'Unavailable' : 'Local API'}</strong></div>
            {busy ? <div><span>Progress</span><strong>{progress}%</strong></div> : null}
            {unavailable && jobSpec.capability ? (
              <div><span>Reason</span><strong>{reason(jobSpec.capability) || 'Not available'}</strong></div>
            ) : null}
          </div>
          <div className="button-row full-button-row">
            <SecondaryButton icon="eye" onClick={() => notify(files.length ? `${files.length} file(s) queued` : 'No files yet')} disabled={busy}>
              Preview
            </SecondaryButton>
            <PrimaryButton icon="download" onClick={start} disabled={busy || unavailable}>
              {unavailable ? 'Unavailable' : 'Export'}
            </PrimaryButton>
          </div>
        </aside>
      </section>
      <JobOutputCard job={job} notify={notify} />
    </div>
  );
}

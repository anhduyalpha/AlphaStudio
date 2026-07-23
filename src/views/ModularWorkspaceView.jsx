import React, { useMemo, useState } from 'react';
import FilePicker from '../components/FilePicker';
import JobOutputCard from '../components/JobOutputCard';
import EmptyState from '../components/EmptyState';
import {
  FeatureRail,
  PrimaryButton,
  SecondaryButton,
  SelectField,
  StatusBadge,
  TextField,
  ToggleRow,
  WorkspaceTabs,
  Panel,
} from '../components/Common';
import { WorkbenchLayout, WorkspaceHeader, ProgressWave, CapabilityBanner } from '../components/Workbench';
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
  const isClientOnly = Boolean(currentFeature.clientOnly);
  const capOk = isClientOnly
    ? true
    : jobSpec.capability == null
      ? true
      : capsLoading
        ? null
        : isAvailable(jobSpec.capability);
  const unavailable = !isClientOnly && (capOk === false || capOk === null);
  const family = config.family || config.id || 'neutral';

  const start = async () => {
    if (isClientOnly) {
      notify(currentFeature.clientMessage || 'This action runs entirely in your browser — no server job.');
      return;
    }
    if (unavailable) {
      notify(`Unavailable: ${reason(jobSpec.capability) || jobSpec.capability || 'loading capabilities…'}`);
      return;
    }
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
    const isExtract = jobSpec.operation === 'extract';
    const format = isExtract ? 'auto' : currentFeature.format || config.defaultFormat;
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
    <div className={`view-stack modular-workbench family-${family}`} data-testid="modular-workbench">
      <WorkspaceHeader
        meta={config.eyebrow}
        title={config.title}
        description={config.description}
        family={family}
        status={(
          <StatusBadge
            status={unavailable ? 'unavailable' : busy ? 'converting' : 'completed'}
            tone={unavailable ? 'neutral' : busy ? 'cyan' : 'green'}
            live={busy}
          >
            {unavailable ? 'Unavailable' : busy ? status || 'Running' : 'Ready'}
          </StatusBadge>
        )}
        actions={(
          <>
            <SecondaryButton icon="refresh" onClick={() => { setFiles([]); notify('Workspace reset.'); }} disabled={busy}>
              Reset
            </SecondaryButton>
            {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
          </>
        )}
      />

      <WorkspaceTabs tabs={config.tabs} active={activeTab} onChange={setActiveTab} />

      {unavailable ? (
        <>
          <CapabilityBanner
            title="Capability unavailable"
            reason={reason(jobSpec.capability) || 'The required local capability is not available.'}
          />
          <EmptyState
            type="toolsMissing"
            compact
            description={reason(jobSpec.capability) || 'The required local capability is not available.'}
          />
        </>
      ) : null}

      <WorkbenchLayout
        family={family}
        stage={(
          <Panel title={currentFeature.title} actions={<StatusBadge tone={config.tone || 'cyan'}>{files.length} files</StatusBadge>}>
            <p className="workspace-description" style={{ marginTop: 0 }}>{currentFeature.description}</p>
            <FilePicker
              title={currentFeature.dropTitle || 'Drop source files here'}
              subtitle={currentFeature.dropSubtitle || 'Browse from your computer or drag files into this panel'}
              accept={currentFeature.accept || config.accept}
              multiple={currentFeature.multiple !== false}
              files={files}
              onChange={setFiles}
              disabled={busy}
            />
            {busy ? <ProgressWave value={progress} label="Job progress" /> : null}
            <JobOutputCard job={job} notify={notify} />
          </Panel>
        )}
        rail={(
          <>
            <Panel title="Operations">
              <FeatureRail
                label="Operations"
                active={activeFeature}
                onChange={(item) => setActiveFeature(item.title)}
                items={config.features.map((feature) => ({
                  title: feature.title,
                  description: feature.short,
                  icon: feature.icon,
                }))}
              />
            </Panel>
            <Panel title="Options">
              <div className="form-grid compact-form-grid">
                <SelectField label="Processing preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
                  <option value="balanced">Balanced</option>
                  <option value="max">Maximum quality</option>
                  <option value="small">Smallest output</option>
                </SelectField>
                <TextField label="Output name" placeholder="alphastudio-output" value={outputName} onChange={(e) => setOutputName(e.target.value)} />
                {jobSpec.operation === 'compare' ? (
                  <TextField
                    label="Expected checksum (hex)"
                    placeholder="e.g. sha256 hex digest"
                    value={expectedDigest}
                    onChange={(e) => setExpectedDigest(e.target.value)}
                  />
                ) : null}
              </div>
              <div className="toggle-stack compact-toggle-stack" style={{ marginTop: 12 }}>
                <ToggleRow
                  title="Preserve metadata"
                  description="Keep supported source metadata in the output when possible."
                  checked={preserveMeta}
                  onChange={(e) => setPreserveMeta(e.target.checked)}
                />
              </div>
            </Panel>
            <Panel title="Summary">
              <div className="preview-info-list">
                <div><span>Operation</span><strong>{currentFeature.title}</strong></div>
                <div><span>Tab</span><strong>{activeTab}</strong></div>
                <div><span>Files</span><strong>{files.length}</strong></div>
                <div><span>Engine</span><strong>{unavailable ? 'Unavailable' : 'Local API'}</strong></div>
              </div>
              {files.length === 0 && !unavailable ? (
                <EmptyState type="noResults" compact title="No files yet" description="Add files to the stage to enable export." />
              ) : null}
            </Panel>
          </>
        )}
        runbar={(
          <>
            <div className="job-row-main">
              <strong>{currentFeature.title}</strong>
              <span>{unavailable ? 'Blocked by capability' : busy ? `${progress}% · ${status || 'running'}` : 'Ready to run'}</span>
            </div>
            <div className="hero-button-row">
              {busy ? <SecondaryButton icon="close" onClick={cancel}>Cancel</SecondaryButton> : null}
              <PrimaryButton
                icon={unavailable ? 'lock' : config.primaryIcon || 'wand'}
                onClick={start}
                disabled={busy || unavailable}
                busy={busy}
              >
                {unavailable ? 'Unavailable' : config.primaryAction}
              </PrimaryButton>
            </div>
          </>
        )}
      />
    </div>
  );
}

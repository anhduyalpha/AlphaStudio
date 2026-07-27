import React from 'react';
import useStore from '../next/hooks/useStore.js';
import {
  Banner,
  Button,
  Card,
  Dropzone,
  EmptyState,
  ErrorState,
  Field,
  FileList,
  FileRow,
  Icon,
  ResumeStrip,
  RunBar,
  Skeleton,
  StatusBadge,
  Tabs,
  Toggle,
} from '../next/components/index.jsx';
import { readActiveJobId, selectRunProgress } from '../protocol/store.js';
import RegisteredPanel from './registry.jsx';

const selectSnapshot = (snapshot) => snapshot;
const noop = () => {};

export function selectedWorkbenchFiles(snapshot) {
  if (!snapshot.selectedFileIds.length) return snapshot.files;
  const selected = new Set(snapshot.selectedFileIds);
  return snapshot.files.filter((file) => selected.has(file.id));
}

export function scopeWorkbenchAttempt(
  snapshot,
  {
    jobEnabled = true,
    jobType,
    jobIds = [],
  } = {},
) {
  if (!jobEnabled) {
    return { jobIds: [], jobs: [], activeJobs: [], failedJob: null, outputs: [] };
  }
  const ids = new Set(jobIds.filter(Boolean));
  const jobs = snapshot.jobs.filter((job) => (
    ids.has(job.id) && (!jobType || job.type === jobType)
  ));
  const scopedIds = new Set(jobs.map((job) => job.id));
  return {
    jobIds: [...scopedIds],
    jobs,
    activeJobs: jobs.filter((job) => job.status === 'running' || job.status === 'queued'),
    failedJob: jobs.find((job) => job.status === 'failed') || null,
    outputs: snapshot.outputs.filter((output) => scopedIds.has(output.jobId)),
  };
}

export function workbenchProgress(snapshot, jobIds = []) {
  const ids = new Set(jobIds);
  const attemptFiles = ids.size
    ? snapshot.files.filter((file) => ids.has(file.jobId))
    : selectedWorkbenchFiles(snapshot);
  const files = attemptFiles.length ? attemptFiles : selectedWorkbenchFiles(snapshot);
  return selectRunProgress(snapshot, files.map((file) => file.id));
}

function OptionControl({ option, value, onChange }) {
  const common = {
    label: option.label || option.id,
    hint: option.hint,
    disabled: option.disabled,
  };
  if (option.type === 'toggle') {
    return (
      <Toggle
        label={common.label}
        description={common.hint}
        disabled={common.disabled}
        checked={Boolean(value ?? option.default)}
        onChange={(next) => onChange(option.id, next)}
      />
    );
  }
  if (option.type === 'derived') {
    return (
      <div className="workbench-derived">
        <span>{common.label}</span>
        <output>{value ?? option.value ?? 'Calculated when input is ready'}</output>
      </div>
    );
  }
  const variant = ['select', 'range', 'color', 'textarea'].includes(option.type)
    ? option.type
    : 'text';
  const controlled = value !== undefined
    ? {
        value,
        onChange: (event) => onChange(option.id, event.currentTarget.value),
      }
    : {
        defaultValue: option.default,
        onChange: (event) => onChange(option.id, event.currentTarget.value),
      };
  return (
    <Field
      {...common}
      {...controlled}
      variant={variant}
      options={option.options || []}
      min={option.min}
      max={option.max}
      step={option.step}
      required={option.required}
    />
  );
}

function InputRegion({
  hub,
  mode,
  snapshot,
  files,
  accept,
  inputValue,
  onInputValueChange,
  onFiles,
  onRemoveFile,
  onResumeUpload,
  onDiscardUpload,
}) {
  const input = mode.input || { kind: 'files' };
  const sessions = snapshot.uploadSessions.map((session) => ({
    ...session,
    hubId: hub.id,
    modeId: mode.id,
  }));

  if (input.kind === 'text') {
    return (
      <Field
        label={input.label || 'Input text'}
        hint={input.hint}
        variant="textarea"
        value={inputValue || ''}
        onChange={(event) => onInputValueChange(event.currentTarget.value)}
      />
    );
  }

  if (input.kind === 'none') {
    return (
      <EmptyState
        variant="compact"
        visual={<Icon name="sparkles" />}
        title="No source input needed"
        description="Configure the mode, then run it when ready."
        action={<Button size="sm" variant="ghost" onClick={noop}>Review options</Button>}
      />
    );
  }

  return (
    <div className="workbench-input-stack">
      {sessions.length ? (
        <ResumeStrip
          variant="uploads-only"
          uploadSessions={sessions}
          onResume={onResumeUpload}
          onDiscard={onDiscardUpload}
        />
      ) : null}
      <Dropzone
        accept={accept}
        multiple={input.multiple}
        empty={files.length === 0}
        onFiles={onFiles}
      />
      <FileList
        items={files}
        emptyTitle="No input files"
        emptyDescription="Drop files above or browse from your device."
        renderItem={(file) => (
          <FileRow
            {...file}
            key={file.id}
            name={file.originalName || file.name}
            selected={snapshot.selectedFileIds.includes(file.id)}
            progress={file.composedProgress || file.uploadProgress}
            actions={onRemoveFile ? (
              <Button
                variant="ghost"
                size="sm"
                icon="trash"
                onClick={() => onRemoveFile(file)}
              >
                Remove
              </Button>
            ) : null}
          />
        )}
      />
    </div>
  );
}

function ConfigureRegion({
  mode,
  optionValues,
  onOptionChange,
  panelState,
  onPanelDispatch,
  onPanelRecover,
}) {
  const options = mode.options || [];
  const panels = mode.panels || [];
  if (!options.length && !panels.length) {
    return (
      <EmptyState
        variant="compact"
        visual={<Icon name="settings" />}
        title="No configuration required"
        description="This workflow uses its published safe defaults."
        action={<Button size="sm" variant="ghost" onClick={noop}>Use defaults</Button>}
      />
    );
  }
  return (
    <div className="workbench-configure-stack">
      {options.map((option) => (
        <OptionControl
          key={option.id}
          option={option}
          value={optionValues[option.id]}
          onChange={onOptionChange}
        />
      ))}
      {panels.map((panelKey) => (
        <RegisteredPanel
          key={panelKey}
          panelKey={panelKey}
          state={panelState[panelKey]}
          dispatch={(action) => onPanelDispatch(panelKey, action)}
          onRecover={() => onPanelRecover(panelKey)}
        />
      ))}
    </div>
  );
}

function ResultsRegion({
  snapshot,
  failedJob,
  outputs,
  onDownload,
  onDownloadBatch,
  onRetry,
  onRemoveResult,
  onRetryHydrate,
  onAddInput,
}) {
  if (snapshot.status === 'hydrating') {
    return <Skeleton variant="row" lines={5} label="Loading results" />;
  }
  if (snapshot.error) {
    return (
      <ErrorState
        title="Workspace results are unavailable"
        message={snapshot.error.message}
        actionLabel="Retry loading"
        onAction={onRetryHydrate}
      />
    );
  }
  const failedState = failedJob ? (
    <div className="workbench-result-error">
      <ErrorState
        title={failedJob.outputName || failedJob.type || 'Job failed'}
        message={failedJob.error || failedJob.message || 'The operation did not complete.'}
        actionLabel="Retry input"
        onAction={() => onRetry(failedJob)}
      />
      <Button
        size="sm"
        variant="ghost"
        icon="trash"
        onClick={() => onRemoveResult(failedJob)}
      >
        Remove failed row
      </Button>
    </div>
  ) : null;
  if (!outputs.length && !failedJob) {
    return (
      <EmptyState
        variant="compact"
        visual={<Icon name="download" />}
        title="No results yet"
        description="Completed outputs will stay available in this workspace."
        action={<Button size="sm" variant="secondary" onClick={onAddInput}>Add input</Button>}
      />
    );
  }
  return (
    <div className="workbench-results-stack">
      {failedState}
      {outputs.length > 1 ? (
        <Button size="sm" variant="secondary" icon="download" onClick={() => onDownloadBatch(outputs)}>
          Download batch ZIP
        </Button>
      ) : null}
      <FileList
        label="Results"
        items={outputs}
        renderItem={(result) => (
          <FileRow
            key={result.id}
            name={result.name || result.outputName}
            status="completed"
            actions={(
              <>
                <Button size="sm" variant="secondary" icon="download" onClick={() => onDownload(result)}>
                  Download
                </Button>
                <Button size="sm" variant="ghost" icon="trash" onClick={() => onRemoveResult(result)}>
                  Remove
                </Button>
              </>
            )}
          />
        )}
      />
    </div>
  );
}

export default function Workbench({
  hub,
  mode,
  capability = { available: true },
  accept,
  optionValues = {},
  panelState = {},
  inputValue = '',
  attemptJobIds = [],
  localResults = [],
  onModeChange = noop,
  onOptionChange = noop,
  onPanelDispatch = noop,
  onPanelRecover = noop,
  onInputValueChange = noop,
  onFiles = noop,
  onRemoveFile,
  onResumeUpload = noop,
  onDiscardUpload = noop,
  onRun,
  onCancel,
  onDownload = noop,
  onDownloadBatch = noop,
  onRetry = noop,
  onRemoveResult = noop,
  onRetryHydrate = noop,
  actionError = '',
  unsupportedFiles = [],
}) {
  const snapshot = useStore(selectSnapshot);
  const files = selectedWorkbenchFiles(snapshot);
  const selectedMode = mode || hub.modes[0];
  const jobRun = selectedMode.run?.job;
  const resumeJobId = jobRun ? readActiveJobId(hub.id, selectedMode.id) : null;
  const attempt = scopeWorkbenchAttempt(snapshot, {
    jobEnabled: Boolean(jobRun),
    jobType: jobRun?.jobType,
    jobIds: [...attemptJobIds, resumeJobId],
  });
  const outputs = [...attempt.outputs, ...localResults];
  const activeJobs = attempt.activeJobs;
  const progress = workbenchProgress(snapshot, attempt.jobIds);
  const capabilityReason = capability.available === false ? capability.reason : '';
  const implementationReason = typeof onRun === 'function' ? '' : 'This mode is not implemented yet.';
  const inputReason = (selectedMode.input?.kind || 'files') === 'files' && files.length === 0
    ? 'Add at least one file to run.'
    : '';
  const disabledReason = capabilityReason || implementationReason || inputReason;
  const busy = activeJobs.length > 0;
  const modeItems = hub.modes.map((item) => ({ id: item.id, label: item.name }));

  return (
    <section className="workbench" aria-label={`${hub.name} workbench`}>
      <header className="workbench__header">
        <div>
          <p className="view-eyebrow">Shared workbench</p>
          <h2>{selectedMode.name}</h2>
        </div>
        <StatusBadge tone={capabilityReason ? 'warning' : 'success'}>
          {capabilityReason ? 'Capability unavailable' : 'Mode ready'}
        </StatusBadge>
      </header>
      <Tabs
        className="workbench__modes"
        aria-label={`${hub.name} modes`}
        variant="underline"
        items={modeItems}
        value={selectedMode.id}
        onChange={onModeChange}
      />
      {capabilityReason ? (
        <Banner tone="warning" title="This mode cannot run" icon={<Icon name="warning" />}>
          {capabilityReason}
        </Banner>
      ) : null}
      {actionError ? (
        <Banner tone="danger" title="Convert action needs attention" icon={<Icon name="warning" />}>
          {actionError}
        </Banner>
      ) : null}
      {unsupportedFiles.length ? (
        <Banner tone="warning" title={`${unsupportedFiles.length} unsupported ${unsupportedFiles.length === 1 ? 'file' : 'files'}`} icon={<Icon name="warning" />}>
          Remove the unsupported input or upload a repaired version before converting it.
        </Banner>
      ) : null}
      <div className="workbench__workspace">
        <Card className="workbench__region workbench__input" title="Input" subtitle="Sources and resumable uploads">
          <InputRegion
            hub={hub}
            mode={selectedMode}
            snapshot={snapshot}
            files={files}
            accept={accept}
            inputValue={inputValue}
            onInputValueChange={onInputValueChange}
            onFiles={onFiles}
            onRemoveFile={onRemoveFile}
            onResumeUpload={onResumeUpload}
            onDiscardUpload={onDiscardUpload}
          />
        </Card>
        <Card className="workbench__region workbench__configure" title="Configure" subtitle="Published options and editors">
          <ConfigureRegion
            mode={selectedMode}
            optionValues={optionValues}
            onOptionChange={onOptionChange}
            panelState={panelState}
            onPanelDispatch={onPanelDispatch}
            onPanelRecover={onPanelRecover}
          />
        </Card>
        <Card className="workbench__region workbench__results" title="Results" subtitle="Outputs and recovery">
          <ResultsRegion
            snapshot={snapshot}
            failedJob={attempt.failedJob}
            outputs={outputs}
            onDownload={onDownload}
            onDownloadBatch={onDownloadBatch}
            onRetry={onRetry}
            onRemoveResult={onRemoveResult}
            onRetryHydrate={onRetryHydrate}
            onAddInput={noop}
          />
        </Card>
      </div>
      <div className="workbench__run">
        <RunBar
          busy={busy}
          disabled={Boolean(disabledReason)}
          status={busy ? `Running ${activeJobs.length} ${activeJobs.length === 1 ? 'job' : 'jobs'}` : disabledReason || 'Ready to run'}
          progress={busy ? progress : undefined}
          secondaryAction={busy && onCancel ? <Button onClick={onCancel}>Cancel</Button> : null}
          primaryAction={(
            <Button variant="primary" busy={busy} disabled={Boolean(disabledReason)} onClick={onRun}>
              {busy ? 'Running' : selectedMode.run?.label || 'Run mode'}
            </Button>
          )}
        />
      </div>
    </section>
  );
}

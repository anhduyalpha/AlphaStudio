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
import { applyResultVisibility } from '../lib/converterGroups.js';
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
    return {
      jobIds: [], jobs: [], activeJobs: [], failedJobs: [], failedJob: null, outputs: [],
    };
  }
  const ids = new Set(jobIds.filter(Boolean));
  const jobs = snapshot.jobs.filter((job) => (
    ids.has(job.id) && (!jobType || job.type === jobType)
  ));
  const scopedIds = new Set(jobs.map((job) => job.id));
  const failedJobs = jobs.filter((job) => job.status === 'failed');
  return {
    jobIds: [...scopedIds],
    jobs,
    activeJobs: jobs.filter((job) => job.status === 'running' || job.status === 'queued'),
    failedJobs,
    failedJob: failedJobs[0] || null,
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

function GroupBoard({ board }) {
  if (!board?.groups?.length) {
    return (
      <EmptyState
        variant="compact"
        visual={<Icon name="inspecting" />}
        title="Waiting for detected groups"
        description="Upload a supported file; compatible targets will appear here."
        action={<Button size="sm" variant="ghost" onClick={noop}>Review input</Button>}
      />
    );
  }
  const selected = new Set((board.selectedFileIds || []).map(String));
  return (
    <section className="conversion-board" aria-label="Detected conversion groups">
      <header className="conversion-board__header">
        <div>
          <strong>Detected groups</strong>
          <span>{board.groups.length} compatible {board.groups.length === 1 ? 'group' : 'groups'}</span>
        </div>
        <StatusBadge tone={selected.size ? 'live' : 'neutral'}>
          {selected.size} selected
        </StatusBadge>
      </header>
      <div className="conversion-board__groups">
        {board.groups.map((group) => {
          const settings = group.settings || {};
          const availableOutputs = (group.outputs || []).filter((output) => output.available);
          const unavailableOutputs = (group.outputs || []).filter((output) => !output.available);
          const allSelected = group.fileIds.every((id) => selected.has(String(id)));
          return (
            <section className="conversion-group" key={group.id} aria-label={group.label}>
              <header className="conversion-group__header">
                <div>
                  <strong>{group.label}</strong>
                  <span>
                    {group.fileIds.length} {group.fileIds.length === 1 ? 'file' : 'files'}
                    {' · '}
                    {group.engine || 'Engine not published'}
                  </span>
                </div>
                <StatusBadge tone={group.valid ? 'success' : 'warning'}>
                  {group.valid ? 'Ready' : 'Unavailable'}
                </StatusBadge>
              </header>
              <p className="conversion-group__members">
                {group.members.map((member) => member.originalName || member.name).join(', ')}
              </p>
              {unavailableOutputs.length ? (
                <div className="conversion-group__unavailable" role="status">
                  <strong>Unavailable targets</strong>
                  <span>
                    {unavailableOutputs.map((output) => (
                      `${output.label || String(output.format).toUpperCase()}: ${output.reason || 'Required engine is unavailable'}`
                    )).join(' · ')}
                  </span>
                </div>
              ) : null}
              <div className="conversion-group__options">
                <Field
                  label="Target"
                  variant="select"
                  value={settings.format || ''}
                  options={availableOutputs.map((output) => ({
                    value: output.format,
                    label: output.label || String(output.format).toUpperCase(),
                  }))}
                  disabled={board.disabled || !availableOutputs.length}
                  onChange={(event) => board.onSettingChange(group.id, 'format', event.currentTarget.value)}
                />
                <Field
                  label="Quality"
                  variant="select"
                  value={settings.quality || ''}
                  options={(board.qualityPresets || []).map((preset) => ({
                    value: preset,
                    label: preset.replace(/(^|\s)\S/g, (letter) => letter.toUpperCase()),
                  }))}
                  disabled={board.disabled || !board.qualityPresets?.length}
                  onChange={(event) => board.onSettingChange(group.id, 'quality', event.currentTarget.value)}
                />
                <Toggle
                  label="Preserve metadata"
                  disabled={board.disabled}
                  checked={settings.preserveMetadata !== false}
                  onChange={(value) => board.onSettingChange(group.id, 'preserveMetadata', value)}
                />
              </div>
              <div className="conversion-group__actions">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => board.onSelectGroup(group.id, !allSelected)}
                >
                  {allSelected ? 'Clear group' : 'Select group'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={board.disabled || !group.valid}
                  onClick={() => board.onApplySettings(group.id)}
                >
                  Apply to compatible
                </Button>
                {group.active ? (
                  <Button size="sm" variant="secondary" onClick={() => board.onCancelGroup(group.id)}>
                    Cancel group
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={board.disabled || !group.canRun}
                    onClick={() => board.onRunGroup(group.id)}
                  >
                    Convert group
                  </Button>
                )}
              </div>
            </section>
          );
        })}
      </div>
      <footer className="conversion-board__footer">
        <span>{selected.size ? `${selected.size} files selected` : 'Select files for a cross-group batch'}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!selected.size || !board.canRunSelected}
          onClick={board.onRunSelected}
        >
          Convert selected
        </Button>
      </footer>
    </section>
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
  selectedFileIds,
  onToggleFile,
  onMoveFile,
  pauseableFileIds,
  onPauseFile,
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
        renderItem={(file) => {
          const index = files.findIndex((item) => String(item.id) === String(file.id));
          return (
            <FileRow
              key={file.id}
              name={file.originalName || file.name}
              size={file.size}
              status={file.status === 'processing' ? 'inspecting' : file.status}
              statusLabel={file.message || undefined}
              selected={(selectedFileIds || snapshot.selectedFileIds).includes(String(file.id))}
              progress={file.composedProgress || file.uploadProgress}
              actions={onRemoveFile || onToggleFile || onMoveFile ? (
                <>
                  {onToggleFile ? (
                    <label className="workbench-file-select">
                      <input
                        type="checkbox"
                        aria-label={`Select ${file.originalName || file.name}`}
                        checked={(selectedFileIds || []).includes(String(file.id))}
                        onChange={() => onToggleFile(file.id)}
                      />
                      <span>Select</span>
                    </label>
                  ) : null}
                  {onMoveFile && (selectedFileIds || []).includes(String(file.id)) ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={index === 0}
                        onClick={() => onMoveFile(file.id, -1)}
                      >
                        Move up
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={index === files.length - 1}
                        onClick={() => onMoveFile(file.id, 1)}
                      >
                        Move down
                      </Button>
                    </>
                  ) : null}
                  {onPauseFile && pauseableFileIds?.includes(String(file.id)) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onPauseFile(file)}
                    >
                      Pause
                    </Button>
                  ) : null}
                  {onRemoveFile ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="trash"
                      onClick={() => onRemoveFile(file)}
                    >
                      Remove
                    </Button>
                  ) : null}
                </>
              ) : null}
            />
          );
        }}
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
  groupBoard,
}) {
  const options = groupBoard ? [] : mode.options || [];
  const panels = mode.panels || [];
  if (!options.length && !panels.length && !groupBoard) {
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
      {groupBoard ? <GroupBoard board={groupBoard} /> : null}
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
  failedJobs,
  outputs,
  resultRows,
  batchOutputs,
  onDownload,
  onDownloadBatch,
  onRetry,
  onRetryAll,
  onRemoveResult,
  onRemoveBadInput,
  onRetryHydrate,
  onAddInput,
}) {
  const [filters, setFilters] = React.useState({
    status: 'all',
    format: 'all',
    sort: 'newest',
  });
  const [selectedIds, setSelectedIds] = React.useState(() => new Set());
  const [hiddenIds, setHiddenIds] = React.useState([]);
  const rows = resultRows?.length
    ? resultRows
    : [
        ...(failedJobs || []),
        ...outputs.map((output) => ({ ...output, status: 'completed' })),
      ];
  const visibleRows = applyResultVisibility(rows, { ...filters, hiddenIds });
  const formats = [...new Set(rows
    .flatMap((row) => [row.outputFormat, row.inputFormat])
    .filter(Boolean)
    .map(String))]
    .sort((a, b) => a.localeCompare(b));
  const completedRows = rows.filter((row) => (
    row.status === 'completed' && !hiddenIds.includes(String(row.id))
  ));
  const selectedRows = rows.filter((row) => selectedIds.has(String(row.id)));
  const failedRows = rows.filter((row) => row.status === 'failed');
  const toggleResult = (id) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      const key = String(id);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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
  if (!rows.length) {
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
      <div className="workbench-results-filters">
        <Field
          label="Status"
          variant="select"
          value={filters.status}
          options={[
            { value: 'all', label: 'All' },
            { value: 'queued', label: 'Queued' },
            { value: 'running', label: 'Processing' },
            { value: 'completed', label: 'Completed' },
            { value: 'failed', label: 'Failed' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          onChange={(event) => setFilters((current) => ({
            ...current, status: event.currentTarget.value,
          }))}
        />
        <Field
          label="Format"
          variant="select"
          value={filters.format}
          options={[
            { value: 'all', label: 'All formats' },
            ...formats.map((format) => ({ value: format, label: format.toUpperCase() })),
          ]}
          onChange={(event) => setFilters((current) => ({
            ...current, format: event.currentTarget.value,
          }))}
        />
        <Field
          label="Sort"
          variant="select"
          value={filters.sort}
          options={[
            { value: 'newest', label: 'Newest' },
            { value: 'oldest', label: 'Oldest' },
            { value: 'name', label: 'Name' },
            { value: 'status', label: 'Status' },
          ]}
          onChange={(event) => setFilters((current) => ({
            ...current, sort: event.currentTarget.value,
          }))}
        />
      </div>
      <div className="workbench-results-actions">
        {batchOutputs.length > 1 ? (
          <Button size="sm" variant="secondary" icon="download" onClick={() => onDownloadBatch(batchOutputs)}>
            Download current batch
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="secondary"
          icon="download"
          disabled={!completedRows.length}
          onClick={() => onDownloadBatch(completedRows)}
        >
          Download all
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="download"
          disabled={!selectedRows.some((row) => row.status === 'completed')}
          onClick={() => onDownloadBatch(selectedRows.filter((row) => row.status === 'completed'))}
        >
          Download selected
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon="trash"
          disabled={!completedRows.length}
          onClick={() => setHiddenIds((current) => [
            ...new Set([...current, ...completedRows.map((row) => String(row.id))]),
          ])}
        >
          Clear completed
        </Button>
        {hiddenIds.length ? (
          <Button size="sm" variant="ghost" onClick={() => setHiddenIds([])}>
            Show completed
          </Button>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          disabled={!failedRows.length}
          onClick={() => onRetryAll(failedRows)}
        >
          Retry failed
        </Button>
      </div>
      {!visibleRows.length ? (
        <EmptyState
          variant="compact"
          visual={<Icon name="download" />}
          title="No matching results"
          description="Adjust the filters or show completed outputs."
          action={hiddenIds.length
            ? <Button size="sm" variant="ghost" onClick={() => setHiddenIds([])}>Show completed</Button>
            : null}
        />
      ) : null}
      <FileList
        label="Results"
        items={visibleRows}
        renderItem={(result) => (
          <FileRow
            key={result.id}
            name={result.name || result.outputName}
            meta={[
              result.outputFormat ? String(result.outputFormat).toUpperCase() : '',
              result.sourceLabel || '',
              result.detail || '',
            ].filter(Boolean).join(' | ')}
            status={result.status === 'running' ? 'converting' : result.status}
            statusLabel={result.error || result.message || undefined}
            progress={['queued', 'running'].includes(result.status) ? result.progress : undefined}
            selected={selectedIds.has(String(result.id))}
            actions={(
              <>
                <label className="workbench-file-select">
                  <input
                    type="checkbox"
                    aria-label={`Select result ${result.name || result.outputName || result.id}`}
                    checked={selectedIds.has(String(result.id))}
                    onChange={() => toggleResult(result.id)}
                  />
                  <span>Select</span>
                </label>
                {result.status === 'completed' ? (
                  <Button size="sm" variant="secondary" icon="download" onClick={() => onDownload(result)}>
                    Download
                  </Button>
                ) : null}
                {result.status === 'failed' ? (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => onRetry(result)}>
                      Retry
                    </Button>
                    {(result.options?._uploadIds || result.options?.uploadIds || []).length === 1 ? (
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => onRemoveBadInput(result)}>
                        Remove bad input
                      </Button>
                    ) : null}
                  </>
                ) : null}
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
  resultRows = [],
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
  onRetryAll = noop,
  onRemoveResult = noop,
  onRemoveBadInput = noop,
  onRetryHydrate = noop,
  actionError = '',
  unsupportedFiles = [],
  groupBoard,
  pauseableFileIds = [],
  onPauseFile,
  inputFiles,
  selectedFileIds,
  onToggleFile,
  onMoveFile,
  onAddInput = noop,
}) {
  const snapshot = useStore(selectSnapshot);
  const files = inputFiles || (groupBoard ? snapshot.files : selectedWorkbenchFiles(snapshot));
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
  const selectedInputCount = selectedFileIds === undefined
    ? files.length
    : selectedFileIds.length;
  const inputReason = (selectedMode.input?.kind || 'files') === 'files' && selectedInputCount === 0
    ? 'Add at least one file to run.'
    : '';
  const detectionReason = groupBoard && files.length > 0
    ? groupBoard.disabledReason
      || (groupBoard.groups.length === 0 ? 'Wait for a compatible detected input.' : '')
    : '';
  const availabilityReason = capabilityReason || detectionReason;
  const disabledReason = capabilityReason || implementationReason || inputReason || detectionReason;
  const busy = activeJobs.length > 0;
  const modeItems = hub.modes.map((item) => ({ id: item.id, label: item.name }));

  return (
    <section className="workbench" aria-label={`${hub.name} workbench`}>
      <header className="workbench__header">
        <div>
          <p className="view-eyebrow">Shared workbench</p>
          <h2>{selectedMode.name}</h2>
        </div>
        <StatusBadge tone={availabilityReason ? 'warning' : 'success'}>
          {availabilityReason ? 'Capability unavailable' : 'Mode ready'}
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
      {availabilityReason ? (
        <Banner tone="warning" title="This mode cannot run" icon={<Icon name="warning" />}>
          {availabilityReason}
        </Banner>
      ) : null}
      {actionError ? (
        <Banner tone="danger" title={`${hub.name} action needs attention`} icon={<Icon name="warning" />}>
          {actionError}
        </Banner>
      ) : null}
      {unsupportedFiles.length ? (
        <Banner tone="warning" title={`${unsupportedFiles.length} unsupported ${unsupportedFiles.length === 1 ? 'file' : 'files'}`} icon={<Icon name="warning" />}>
          Remove the unsupported input or upload a repaired version before running it.
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
            selectedFileIds={groupBoard?.selectedFileIds || selectedFileIds}
            onToggleFile={groupBoard?.onToggleFile || onToggleFile}
            onMoveFile={onMoveFile}
            pauseableFileIds={pauseableFileIds}
            onPauseFile={onPauseFile}
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
            groupBoard={groupBoard}
          />
        </Card>
        <Card className="workbench__region workbench__results" title="Results" subtitle="Outputs and recovery">
          <ResultsRegion
            snapshot={snapshot}
            failedJobs={attempt.failedJobs}
            outputs={outputs}
            resultRows={resultRows}
            batchOutputs={attempt.outputs}
            onDownload={onDownload}
            onDownloadBatch={onDownloadBatch}
            onRetry={onRetry}
            onRetryAll={onRetryAll}
            onRemoveResult={onRemoveResult}
            onRemoveBadInput={onRemoveBadInput}
            onRetryHydrate={onRetryHydrate}
            onAddInput={onAddInput}
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

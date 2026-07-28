import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  acceptAttributeFor,
  gatedOperation,
  getContractState,
  loadContracts,
  qualityPresets,
} from '../protocol/contracts.js';
import {
  applyPoll,
  hydrate,
  optimisticRequest,
  rememberActiveJob,
  resolveOptimisticUpload,
  resolveRequest,
} from '../protocol/store.js';
import { createUploadTask, recoverUploadSessions } from '../protocol/uploads.js';
import {
  MEDIA_FORMATS,
  buildMediaWorkbenchJobOptions,
  defaultMediaForm,
  mediaOperationCapability,
  mediaOperationsFor,
  showsFormatControl,
  showsQualityControl,
  validateMediaWorkbench,
} from '../lib/mediaJobOptions.js';
import useStore from './useStore.js';

const selectSnapshot = (snapshot) => snapshot;
const MEDIA_PREVIEW_BYTE_LIMIT = 256 * 1024 * 1024;

function requestId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `media-${suffix}`;
}

function failedReason(error) {
  return error instanceof Error ? error.message : String(error || 'Media operation failed');
}

function titleCase(value) {
  return String(value || '').replace(/(^|[-\s])\S/g, (letter) => letter.toUpperCase());
}

function matchesAccept(file, accept) {
  if (!accept) return true;
  const name = String(file?.originalName || file?.name || '').toLowerCase();
  const mime = String(file?.mime || file?.type || '').toLowerCase();
  return accept.split(',').some((token) => {
    const rule = token.trim().toLowerCase();
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1));
    return rule && mime === rule;
  });
}

function modeJobType(modeId) {
  if (modeId === 'image') return 'image';
  if (modeId === 'audio') return 'audio';
  return 'media';
}

function resolvedOptions(modeId, operation, form, operationChoices, presets) {
  const options = [{
    id: 'operation',
    type: 'select',
    label: `${titleCase(modeId)} operation`,
    options: operationChoices,
    disabled: !operationChoices.length,
  }];

  if (modeId === 'image') {
    if (operation !== 'strip-metadata') {
      options.push({
        id: 'format',
        type: 'select',
        label: 'Output format',
        options: MEDIA_FORMATS.image.map((format) => ({
          value: format,
          label: format.toUpperCase(),
        })),
      });
    }
    if (operation === 'resize') {
      options.push(
        { id: 'width', type: 'text', label: 'Width', hint: 'Natural pixels; height may be left blank.' },
        { id: 'height', type: 'text', label: 'Height', hint: 'Natural pixels; width may be left blank.' },
      );
    }
    if (operation === 'rotate') {
      options.push({
        id: 'angle',
        type: 'select',
        label: 'Clockwise angle',
        options: ['90', '180', '270'].map((value) => ({ value, label: `${value}°` })),
      });
    }
    if (['optimize', 'convert', 'compress'].includes(operation)) {
      options.push({
        id: 'quality',
        type: 'range',
        label: 'Quality',
        min: 1,
        max: 100,
        step: 1,
        hint: `Encoder quality: ${form.quality || 80}`,
      });
    }
    if (operation !== 'strip-metadata') {
      options.push({
        id: 'stripMeta',
        type: 'toggle',
        label: 'Strip metadata',
        hint: 'Remove EXIF and other embedded metadata when encoding.',
      });
    }
  } else {
    if (operation === 'trim') {
      options.push(
        { id: 'start', type: 'text', label: 'Start (seconds)' },
        { id: 'duration', type: 'text', label: 'Duration (seconds)' },
        {
          id: 'reencodeOnTrim',
          type: 'toggle',
          label: 'Re-encode on trim',
          hint: 'Off preserves the source container with stream-copy.',
        },
      );
    }
    if (showsFormatControl(operation, { reencodeOnTrim: form.reencodeOnTrim })) {
      const formatSet = operation === 'extract-audio' ? MEDIA_FORMATS.audio : MEDIA_FORMATS[modeId];
      options.push({
        id: 'format',
        type: 'select',
        label: 'Output format',
        options: formatSet.map((format) => ({ value: format, label: format.toUpperCase() })),
      });
    }
    if (showsQualityControl(operation, { reencodeOnTrim: form.reencodeOnTrim })) {
      options.push({
        id: 'quality',
        type: 'select',
        label: 'Quality preset',
        options: presets.map((preset) => ({ value: preset, label: titleCase(preset) })),
      });
    }
    if (operation === 'normalize') {
      options.push({
        id: 'targetLoudness',
        type: 'text',
        label: 'Target loudness (LUFS)',
        hint: 'Default −16 LUFS.',
      });
    }
    if (operation === 'inspect') {
      options.push({
        id: 'inspectEngine',
        type: 'derived',
        label: 'Output',
        value: 'Media information JSON via ffprobe',
      });
    }
  }
  return options;
}

function buildResultRows(snapshot, jobType) {
  const jobs = snapshot.jobs.filter((job) => job.type === jobType);
  const files = new Map(snapshot.files.map((file) => [String(file.id), file]));
  const outputsByJob = new Map(
    snapshot.outputs
      .filter((output) => output.jobId)
      .map((output) => [String(output.jobId), output]),
  );
  return jobs.map((job) => {
    const output = outputsByJob.get(String(job.id));
    const inputIds = job.options?._uploadIds || job.options?.uploadIds || [];
    const sourceLabel = inputIds
      .map((id) => files.get(String(id))?.originalName || files.get(String(id))?.name)
      .filter(Boolean)
      .join(', ');
    const name = output?.name || output?.outputName || job.outputName || `${job.options?.operation || job.type} result`;
    const extension = String(name).split('.').pop()?.toLowerCase();
    return {
      ...job,
      ...output,
      id: output?.id || job.id,
      jobId: job.id,
      name,
      status: job.status,
      sourceLabel,
      outputFormat: extension && extension !== name ? extension : undefined,
      detail: [
        output?.mime || job.result?.outputMime || '',
        job.options?.operation ? `operation: ${job.options.operation}` : '',
        job.result?.meta?.duration ? `duration: ${job.result.meta.duration}s` : '',
      ].filter(Boolean).join(' | '),
      options: job.options,
      error: job.error,
      downloadUrl: output?.downloadUrl,
    };
  }).sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export default function useMediaWorkbench({ enabled, mode }) {
  const snapshot = useStore(selectSnapshot);
  const modeId = mode?.id || 'video';
  const jobType = modeJobType(modeId);
  const [contractTick, setContractTick] = useState(0);
  const [form, setForm] = useState(() => defaultMediaForm('video'));
  const [selectedFileId, setSelectedFileId] = useState('');
  const [attemptJobIds, setAttemptJobIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const [previewRetry, setPreviewRetry] = useState(0);
  const [preview, setPreview] = useState({ status: 'idle', file: null, error: '' });
  const [duration, setDuration] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [dimensions, setDimensions] = useState(null);
  const tasksRef = useRef(new Map());

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    void loadContracts().then(() => {
      if (active) setContractTick((value) => value + 1);
    });
    return () => {
      active = false;
    };
  }, [enabled]);

  const operations = useMemo(() => mediaOperationsFor(modeId), [modeId]);
  const operation = operations.find((entry) => entry.id === form.operation) || operations[0] || null;
  const effectiveOperation = operation?.id || '';

  useEffect(() => {
    const next = defaultMediaForm(modeId);
    setForm(next);
    setDuration(0);
    setPlayhead(0);
    setDimensions(null);
    setActionError('');
  }, [modeId]);

  const contract = getContractState();
  const presetsLookup = useMemo(() => qualityPresets(), [contractTick]);
  const presets = presetsLookup.available ? presetsLookup.value : [];
  const operationChoices = useMemo(() => operations.map((entry) => {
    const lookup = gatedOperation(entry.capability);
    const unavailable = !lookup.available || Boolean(lookup.value);
    return {
      value: entry.id,
      label: `${entry.label}${unavailable ? ' (unavailable)' : ''}`,
      disabled: unavailable,
    };
  }), [contractTick, operations]);

  const acceptLookup = useMemo(
    () => enabled ? acceptAttributeFor(jobType, effectiveOperation) : { available: false, reason: 'Disabled' },
    [contractTick, effectiveOperation, enabled, jobType],
  );
  const accept = acceptLookup.available ? acceptLookup.value : '';
  const compatibleFiles = useMemo(
    () => snapshot.files.filter((file) => (
      !['deleted', 'missing'].includes(file.status)
      && matchesAccept(file, accept)
    )),
    [accept, snapshot.files],
  );

  useEffect(() => {
    if (!selectedFileId) return;
    if (!compatibleFiles.some((file) => String(file.id) === selectedFileId)) {
      setSelectedFileId('');
    }
  }, [compatibleFiles, selectedFileId]);

  const selectedFile = compatibleFiles.find((file) => String(file.id) === selectedFileId) || null;

  useEffect(() => {
    if (!enabled || !selectedFile) {
      setPreview({ status: 'idle', file: null, error: '' });
      return undefined;
    }
    if (selectedFile.localOnly || selectedFile.status !== 'ready') {
      setPreview({ status: 'loading', file: null, error: '' });
      return undefined;
    }
    if (Number(selectedFile.size) > MEDIA_PREVIEW_BYTE_LIMIT) {
      setPreview({
        status: 'error',
        file: null,
        error: 'Browser preview is limited to 256 MB. Backend processing remains available.',
      });
      return undefined;
    }
    const controller = new AbortController();
    let active = true;
    setPreview({ status: 'loading', file: null, error: '' });
    void api.fetchFileBlob(selectedFile.id, { signal: controller.signal })
      .then((blob) => {
        if (!active) return;
        const name = selectedFile.originalName || selectedFile.name || `source.${modeId}`;
        setPreview({
          status: 'ready',
          file: new File([blob], name, {
            type: blob.type || selectedFile.mime || '',
            lastModified: Date.parse(selectedFile.updatedAt || selectedFile.createdAt || '') || 0,
          }),
          error: '',
        });
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        setPreview({ status: 'error', file: null, error: failedReason(error) });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    enabled,
    modeId,
    previewRetry,
    selectedFile?.createdAt,
    selectedFile?.id,
    selectedFile?.localOnly,
    selectedFile?.mime,
    selectedFile?.originalName,
    selectedFile?.size,
    selectedFile?.status,
    selectedFile?.updatedAt,
  ]);

  const activeJobIds = useMemo(
    () => snapshot.jobs
      .filter((job) => job.type === jobType && ['queued', 'running'].includes(job.status))
      .map((job) => job.id),
    [jobType, snapshot.jobs],
  );
  const currentAttemptJobIds = useMemo(
    () => [...new Set([...attemptJobIds, ...activeJobIds])],
    [activeJobIds, attemptJobIds],
  );
  const resultRows = useMemo(
    () => buildResultRows(snapshot, jobType),
    [jobType, snapshot],
  );
  const resultJob = useMemo(
    () => snapshot.jobs
      .filter((job) => job.type === jobType && job.status === 'completed')
      .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))[0] || null,
    [jobType, snapshot.jobs],
  );

  let capability;
  if (!enabled) {
    capability = { available: true };
  } else if (contract.status === 'idle' || contract.status === 'loading') {
    capability = { available: false, reason: 'Loading media capabilities...' };
  } else if (contract.status === 'unavailable') {
    capability = { available: false, reason: contract.reason };
  } else if (!operation) {
    capability = { available: false, reason: 'No media operation is configured for this mode.' };
  } else if (!acceptLookup.available) {
    capability = { available: false, reason: acceptLookup.reason };
  } else {
    const lookup = gatedOperation(mediaOperationCapability(modeId, effectiveOperation));
    capability = !lookup.available
      ? { available: false, reason: lookup.reason }
      : lookup.value
        ? { available: false, reason: lookup.value.reason }
        : { available: true };
  }

  const resolvedMode = useMemo(() => mode ? ({
    ...mode,
    options: resolvedOptions(
      modeId,
      effectiveOperation,
      form,
      operationChoices,
      presets,
    ),
  }) : mode, [effectiveOperation, form, mode, modeId, operationChoices, presets]);

  const onOptionChange = useCallback((id, value) => {
    setActionError('');
    if (id === 'operation') {
      const next = defaultMediaForm(modeId, String(value));
      if (String(value) === 'trim' && duration > 0) {
        next.duration = String(duration);
      }
      setForm(next);
      return;
    }
    setForm((current) => ({
      ...current,
      [id]: typeof current[id] === 'boolean' ? Boolean(value) : String(value),
    }));
  }, [duration, modeId]);

  const onPanelDispatch = useCallback((_panelKey, action) => {
    if (!action || typeof action !== 'object') return;
    setActionError('');
    if (action.type === 'retry-preview') setPreviewRetry((value) => value + 1);
    if (action.type === 'set-duration') {
      const value = Number(action.value) || 0;
      setDuration((current) => current === value ? current : value);
      setForm((current) => {
        const nextDuration = String(
          Math.max(0.05, Math.min(value || Number(current.duration) || 10, value || 10)),
        );
        return current.duration === nextDuration
          ? current
          : { ...current, duration: nextDuration };
      });
    }
    if (action.type === 'set-playhead') {
      const nextPlayhead = Math.max(0, Math.min(100, Number(action.value) || 0));
      setPlayhead((current) => current === nextPlayhead ? current : nextPlayhead);
    }
    if (action.type === 'set-range') {
      const value = action.value || {};
      setForm((current) => {
        const start = String(Math.max(0, Number(value.start) || 0));
        const nextDuration = String(Math.max(0.05, Number(value.duration) || 0.05));
        return current.start === start && current.duration === nextDuration
          ? current
          : { ...current, start, duration: nextDuration };
      });
    }
    if (action.type === 'set-dimensions') {
      const value = action.value || null;
      setDimensions((current) => (
        current?.width === value?.width && current?.height === value?.height
          ? current
          : value
      ));
      setForm((current) => {
        if (current.crop || !value?.width || !value?.height) return current;
        return {
          ...current,
          crop: {
            left: Math.round(value.width * 0.25),
            top: Math.round(value.height * 0.25),
            width: Math.max(1, Math.round(value.width * 0.5)),
            height: Math.max(1, Math.round(value.height * 0.5)),
          },
        };
      });
    }
    if (action.type === 'set-crop') {
      setForm((current) => ({ ...current, crop: action.value || null }));
    }
  }, []);

  const onToggleFile = useCallback((fileId) => {
    const id = String(fileId);
    setSelectedFileId((current) => current === id ? '' : id);
    setDuration(0);
    setDimensions(null);
    setActionError('');
  }, []);

  const onFiles = useCallback(async (incoming) => {
    if (!snapshot.workspaceId || !acceptLookup.available) {
      setActionError(capability.reason || 'Media input is unavailable.');
      return;
    }
    const files = Array.from(incoming || []);
    const rejected = files.filter((file) => !matchesAccept(file, accept));
    if (rejected.length) {
      setActionError(`${rejected.map((file) => file.name).join(', ')} is not compatible with this mode.`);
      return;
    }
    const file = files[0];
    if (!file) return;
    let task;
    task = createUploadTask(file, { workspaceId: snapshot.workspaceId });
    tasksRef.current.set(task.clientId, task);
    try {
      const uploaded = await task.start();
      setSelectedFileId(String(uploaded.id));
      await hydrate({ route: 'media' });
    } catch (error) {
      if (!['PAUSED', 'CANCELLED'].includes(error?.code)) setActionError(failedReason(error));
    } finally {
      if (['completed', 'failed'].includes(task.state)) tasksRef.current.delete(task.clientId);
    }
  }, [accept, acceptLookup.available, capability.reason, snapshot.workspaceId]);

  const onRemoveFile = useCallback(async (file) => {
    if (!snapshot.workspaceId) return;
    const id = String(file.id);
    setSelectedFileId((current) => current === id ? '' : current);
    if (file.localOnly) {
      const task = tasksRef.current.get(id);
      try {
        if (task) await task.cancel();
        tasksRef.current.delete(id);
        resolveOptimisticUpload(id);
      } catch (error) {
        setActionError(failedReason(error));
      }
      return;
    }
    const key = optimisticRequest('delete', id);
    try {
      await api.removeWorkspaceFile(snapshot.workspaceId, id);
      await hydrate({ route: 'media' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const queueJob = useCallback(async () => {
    if (!snapshot.workspaceId || !selectedFile || !operation) return;
    const validation = validateMediaWorkbench(modeId, { ...form, operation: effectiveOperation }, selectedFile);
    if (validation) {
      setActionError(validation);
      return;
    }
    if (selectedFile.localOnly || selectedFile.status !== 'ready') {
      setActionError('Wait for the selected file to finish uploading and inspection.');
      return;
    }
    let key = '';
    try {
      const clientRequestId = requestId();
      const options = buildMediaWorkbenchJobOptions(modeId, {
        ...form,
        operation: effectiveOperation,
      });
      options._uploadIds = [String(selectedFile.id)];
      const body = {
        type: jobType,
        workspaceId: snapshot.workspaceId,
        uploadIds: [String(selectedFile.id)],
        clientRequestId,
        options,
      };
      key = optimisticRequest('convert', String(selectedFile.id), { clientRequestId });
      const job = await api.createJob(body);
      applyPoll({ job });
      rememberActiveJob('media', modeId, job.id);
      setAttemptJobIds([job.id]);
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      if (key) resolveRequest(key);
    }
  }, [
    effectiveOperation,
    form,
    jobType,
    modeId,
    operation,
    selectedFile,
    snapshot.workspaceId,
  ]);

  const onCancel = useCallback(async () => {
    const active = snapshot.jobs.filter((job) => (
      activeJobIds.includes(job.id) && ['queued', 'running'].includes(job.status)
    ));
    const failures = [];
    await Promise.all(active.map(async (job) => {
      const key = optimisticRequest('cancel', job.id);
      try {
        applyPoll({ job: await api.cancelJob(job.id) });
      } catch (error) {
        failures.push(failedReason(error));
      } finally {
        resolveRequest(key);
      }
    }));
    if (failures.length) setActionError(failures[0]);
  }, [activeJobIds, snapshot.jobs]);

  const retryJobs = useCallback(async (jobs) => {
    if (!snapshot.workspaceId) return;
    const ids = [];
    for (const job of jobs) {
      try {
        const originalId = job.jobId || job.id;
        const original = snapshot.jobs.find((entry) => entry.id === originalId) || job;
        const uploadIds = original.options?._uploadIds || original.options?.uploadIds || [];
        const next = await api.createJob({
          type: original.type || jobType,
          workspaceId: snapshot.workspaceId,
          uploadIds,
          clientRequestId: requestId(),
          options: { ...original.options, _uploadIds: uploadIds },
        });
        applyPoll({ job: next });
        ids.push(next.id);
      } catch (error) {
        setActionError(failedReason(error));
      }
    }
    if (ids.length) setAttemptJobIds(ids);
  }, [jobType, snapshot.jobs, snapshot.workspaceId]);

  const onRemoveResult = useCallback(async (result) => {
    const id = result.jobId || result.id;
    const key = optimisticRequest('delete', id);
    try {
      await api.deleteJob(id);
      await hydrate({ route: 'media' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, []);

  const onDiscardUpload = useCallback(async (session) => {
    try {
      await api.cancelUploadSession(session.id);
      if (snapshot.workspaceId) await recoverUploadSessions(snapshot.workspaceId);
    } catch (error) {
      setActionError(failedReason(error));
    }
  }, [snapshot.workspaceId]);

  const openInput = useCallback(() => {
    document.querySelector('.workbench__input .dropzone__input')?.click();
  }, []);

  return enabled ? {
    mode: resolvedMode,
    capability,
    accept,
    optionValues: { ...form, operation: effectiveOperation },
    panelState: {
      'media-preview': {
        file: selectedFile,
        previewFile: preview.file,
        previewStatus: preview.status,
        previewError: preview.error,
        mode: modeId,
        operation: effectiveOperation,
        duration,
        resultJob,
        disabled: activeJobIds.length > 0,
        visible: !(modeId === 'image' && effectiveOperation === 'crop'),
      },
      waveform: {
        previewFile: preview.file,
        previewStatus: preview.status,
        progress: playhead,
        visible: modeId === 'audio',
      },
      timeline: {
        visible: ['video', 'audio'].includes(modeId) && effectiveOperation === 'trim',
        total: duration,
        start: form.start,
        duration: form.duration,
        disabled: activeJobIds.length > 0,
      },
      crop: {
        file: selectedFile,
        previewFile: preview.file,
        previewStatus: preview.status,
        previewError: preview.error,
        crop: form.crop,
        dimensions,
        disabled: activeJobIds.length > 0,
        visible: modeId === 'image' && effectiveOperation === 'crop',
      },
    },
    inputFiles: compatibleFiles,
    selectedFileIds: selectedFileId ? [selectedFileId] : [],
    attemptJobIds: currentAttemptJobIds,
    resultRows,
    actionError,
    onOptionChange,
    onPanelDispatch,
    onPanelRecover: () => setActionError('Select a readable media file or use manual options.'),
    onToggleFile,
    onFiles,
    onRemoveFile,
    onRun: queueJob,
    onCancel,
    onRetry: (job) => retryJobs([job]),
    onRetryAll: retryJobs,
    onRemoveResult,
    onRemoveBadInput: () => setActionError('Remove the source from Input and upload a repaired file.'),
    onResumeUpload: openInput,
    onDiscardUpload,
    onAddInput: openInput,
    onDownload: async (result) => {
      try {
        if (result.downloadUrl) {
          await api.downloadPath(result.downloadUrl, result.name || result.outputName);
        } else {
          await api.downloadJob(result.jobId || result.id, result.name || result.outputName);
        }
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onDownloadBatch: async (rows) => {
      try {
        await api.downloadOutputsZip(snapshot.workspaceId, {
          outputIds: rows.map((row) => row.outputId || row.id).filter(Boolean),
          jobIds: rows.map((row) => row.jobId).filter(Boolean),
        });
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onRetryHydrate: () => hydrate({ route: 'media' }),
  } : {};
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client.js';
import {
  acceptAttributeFor,
  gatedOperation,
  getContractState,
  loadContracts,
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
  QR_OPERATIONS,
  buildQrJobOptions,
  defaultQrForm,
  extractDecodedQrText,
  matchesQrAccept,
  qrOperationCapability,
  validateQrWorkbench,
} from '../lib/qrJobOptions.js';
import {
  COLOR_IMAGE_OPERATIONS,
  COLOR_MODES,
  buildColorImageJobOptions,
  computeColorLab,
  copyText,
  defaultColorForm,
  downloadText,
  extractPaletteFromFile,
  paletteToJson,
  validateColorImageJob,
} from '../lib/colorPalette.js';
import useStore from './useStore.js';

const selectSnapshot = (snapshot) => snapshot;

function requestId() {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `utilities-${suffix}`;
}

function failedReason(error) {
  return error instanceof Error ? error.message : String(error || 'Utility operation failed');
}

function matchesAccept(file, accept) {
  return matchesQrAccept(file, accept);
}

function gatedChoice(entry) {
  const lookup = gatedOperation(entry.capability);
  const unavailable = !lookup.available || Boolean(lookup.value);
  return {
    value: entry.value || entry.id,
    label: `${entry.label}${unavailable ? ' (unavailable)' : ''}`,
    disabled: unavailable,
  };
}

function qrOptions() {
  return [{
    id: 'operation',
    type: 'select',
    label: 'QR operation',
    options: QR_OPERATIONS.map((entry) => gatedChoice({ ...entry, value: entry.id })),
  }];
}

function colorOptions(colorMode, form) {
  const options = [{
    id: 'colorMode',
    type: 'select',
    label: 'Color workflow',
    options: COLOR_MODES,
  }];
  if (colorMode === 'image') {
    options.push({
      id: 'imageOperation',
      type: 'select',
      label: 'Optional server action',
      options: COLOR_IMAGE_OPERATIONS.map(gatedChoice),
      hint: 'Palette sampling stays local; this action uses the Sharp image processor.',
    });
    if (form.imageOperation === 'optimize') {
      options.push({
        id: 'quality',
        type: 'range',
        label: 'Optimize quality',
        min: 1,
        max: 100,
        step: 1,
        hint: `${form.quality || 80}`,
      });
    }
  } else {
    options.push({
      id: 'execution',
      type: 'derived',
      label: 'Execution',
      value: 'Live in this browser; no server round-trip',
    });
  }
  return options;
}

function jobBelongsToUtilities(job, modeId) {
  if (modeId === 'qr') return job.type === 'qr';
  return job.type === 'image' && job.options?._mode === 'color';
}

function buildResultRows(snapshot, modeId) {
  const files = new Map(snapshot.files.map((file) => [String(file.id), file]));
  const outputsByJob = new Map(
    snapshot.outputs
      .filter((output) => output.jobId)
      .map((output) => [String(output.jobId), output]),
  );
  return snapshot.jobs
    .filter((job) => jobBelongsToUtilities(job, modeId))
    .map((job) => {
      const output = outputsByJob.get(String(job.id));
      const inputIds = job.options?._uploadIds || job.options?.uploadIds || [];
      const sourceLabel = inputIds
        .map((id) => files.get(String(id))?.originalName || files.get(String(id))?.name)
        .filter(Boolean)
        .join(', ');
      const name = output?.name
        || output?.outputName
        || job.outputName
        || `${job.options?.operation || modeId} result`;
      const extension = String(name).split('.').pop()?.toLowerCase();
      return {
        ...job,
        ...output,
        id: output?.id || job.id,
        jobId: job.id,
        name,
        status: job.status,
        sourceLabel: sourceLabel || (job.options?.operation === 'generate' ? 'Inline content' : ''),
        outputFormat: extension && extension !== name ? extension : undefined,
        detail: [
          job.options?.operation ? `operation: ${job.options.operation}` : '',
          job.options?.format ? `format: ${job.options.format}` : '',
        ].filter(Boolean).join(' | '),
        options: job.options,
        error: job.error,
        downloadUrl: output?.downloadUrl,
      };
    })
    .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
}

export default function useUtilitiesWorkbench({ enabled, mode }) {
  const snapshot = useStore(selectSnapshot);
  const modeId = mode?.id || 'qr';
  const [contractTick, setContractTick] = useState(0);
  const [qrForm, setQrForm] = useState(() => defaultQrForm());
  const [colorForm, setColorForm] = useState(() => defaultColorForm());
  const [inputValue, setInputValue] = useState(() => defaultQrForm().content);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [attemptJobIds, setAttemptJobIds] = useState([]);
  const [localResults, setLocalResults] = useState([]);
  const [actionError, setActionError] = useState('');
  const [qrPreview, setQrPreview] = useState({
    status: 'idle',
    previewUrl: '',
    decodedText: '',
    error: '',
  });
  const [colorPalette, setColorPalette] = useState([]);
  const [colorExtraction, setColorExtraction] = useState({ status: 'idle', error: '' });
  const [localImageFile, setLocalImageFile] = useState(null);
  const [localImageUrl, setLocalImageUrl] = useState('');
  const tasksRef = useRef(new Map());
  const qrPreviewUrlRef = useRef('');
  const localImageUrlRef = useRef('');

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

  useEffect(() => {
    setSelectedFileId('');
    setAttemptJobIds([]);
    setLocalResults([]);
    setActionError('');
    setQrPreview({ status: 'idle', previewUrl: '', decodedText: '', error: '' });
    setColorExtraction({ status: 'idle', error: '' });
  }, [modeId]);

  useEffect(() => () => {
    if (qrPreviewUrlRef.current) URL.revokeObjectURL(qrPreviewUrlRef.current);
    if (localImageUrlRef.current) URL.revokeObjectURL(localImageUrlRef.current);
  }, []);

  const effectiveQrOperation = QR_OPERATIONS.some((entry) => entry.id === qrForm.operation)
    ? qrForm.operation
    : 'generate';
  const colorMode = COLOR_MODES.some((entry) => entry.value === colorForm.colorMode)
    ? colorForm.colorMode
    : 'picker';
  const fileMode = (modeId === 'qr' && effectiveQrOperation === 'decode')
    || (modeId === 'color' && colorMode === 'image');
  const acceptLookup = useMemo(
    () => enabled && fileMode
      ? acceptAttributeFor(modeId === 'qr' ? 'qr' : 'image', modeId === 'qr'
        ? effectiveQrOperation
        : colorForm.imageOperation)
      : { available: true, value: '' },
    [
      colorForm.imageOperation,
      contractTick,
      effectiveQrOperation,
      enabled,
      fileMode,
      modeId,
    ],
  );
  const accept = acceptLookup.available ? acceptLookup.value : '';
  const compatibleFiles = useMemo(
    () => snapshot.files.filter((file) => (
      !['deleted', 'missing'].includes(file.status) && (!fileMode || matchesAccept(file, accept))
    )),
    [accept, fileMode, snapshot.files],
  );

  useEffect(() => {
    if (!selectedFileId) return;
    if (!compatibleFiles.some((file) => String(file.id) === selectedFileId)) {
      setSelectedFileId('');
    }
  }, [compatibleFiles, selectedFileId]);

  const selectedFile = compatibleFiles.find((file) => String(file.id) === selectedFileId) || null;
  const activeJobIds = useMemo(
    () => snapshot.jobs
      .filter((job) => jobBelongsToUtilities(job, modeId)
        && ['queued', 'running'].includes(job.status))
      .map((job) => job.id),
    [modeId, snapshot.jobs],
  );
  const currentAttemptJobIds = useMemo(
    () => [...new Set([...attemptJobIds, ...activeJobIds])],
    [activeJobIds, attemptJobIds],
  );
  const remoteResultRows = useMemo(
    () => buildResultRows(snapshot, modeId),
    [modeId, snapshot],
  );
  const resultRows = useMemo(
    () => [...localResults, ...remoteResultRows],
    [localResults, remoteResultRows],
  );
  const latestQrJob = useMemo(
    () => modeId === 'qr'
      ? snapshot.jobs
        .filter((job) => job.type === 'qr'
          && job.status === 'completed'
          && job.options?.operation === effectiveQrOperation)
        .sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''))[0] || null
      : null,
    [effectiveQrOperation, modeId, snapshot.jobs],
  );

  useEffect(() => {
    if (!enabled || modeId !== 'qr' || !latestQrJob?.id) {
      if (qrPreviewUrlRef.current) {
        URL.revokeObjectURL(qrPreviewUrlRef.current);
        qrPreviewUrlRef.current = '';
      }
      setQrPreview({ status: 'idle', previewUrl: '', decodedText: '', error: '' });
      return undefined;
    }
    let active = true;
    setQrPreview({ status: 'loading', previewUrl: '', decodedText: '', error: '' });
    const request = effectiveQrOperation === 'generate'
      ? api.fetchJobBlob(latestQrJob.id).then((blob) => {
          const previewUrl = URL.createObjectURL(blob);
          if (!active) {
            URL.revokeObjectURL(previewUrl);
            return;
          }
          if (qrPreviewUrlRef.current) URL.revokeObjectURL(qrPreviewUrlRef.current);
          qrPreviewUrlRef.current = previewUrl;
          setQrPreview({ status: 'ready', previewUrl, decodedText: '', error: '' });
        })
      : api.fetchJobText(latestQrJob.id).then((text) => {
          if (!active) return;
          const decodedText = extractDecodedQrText(JSON.parse(String(text || '{}')));
          setQrPreview({ status: 'ready', previewUrl: '', decodedText, error: '' });
        });
    void request.catch((error) => {
      if (active) {
        setQrPreview({
          status: 'error',
          previewUrl: '',
          decodedText: '',
          error: failedReason(error),
        });
      }
    });
    return () => {
      active = false;
    };
  }, [effectiveQrOperation, enabled, latestQrJob?.id, modeId]);

  const colorResult = useMemo(
    () => computeColorLab(colorForm, colorPalette),
    [colorForm, colorPalette],
  );

  const extractLocalPalette = useCallback(async (file = localImageFile) => {
    if (!file) {
      setActionError('Add an image before extracting a palette.');
      return;
    }
    setColorExtraction({ status: 'loading', error: '' });
    try {
      const colors = await extractPaletteFromFile(file, { maxColors: 6 });
      setColorPalette(colors);
      if (colors[0]) {
        setColorForm((current) => ({ ...current, hex: colors[0] }));
      }
      setColorExtraction({ status: 'ready', error: '' });
    } catch (error) {
      const reason = failedReason(error);
      setColorExtraction({ status: 'error', error: reason });
      setActionError(reason);
    }
  }, [localImageFile]);

  const contract = getContractState();
  const capabilityId = modeId === 'qr'
    ? qrOperationCapability(effectiveQrOperation)
    : colorMode === 'image'
      ? COLOR_IMAGE_OPERATIONS.find((entry) => entry.value === colorForm.imageOperation)?.capability
      : '';
  let capability = { available: true };
  if (contract.status === 'idle' || contract.status === 'loading') {
    capability = { available: false, reason: 'Utility capabilities are loading.' };
  } else if (contract.status === 'unavailable') {
    capability = { available: false, reason: contract.reason };
  } else if (capabilityId) {
    const lookup = gatedOperation(capabilityId);
    if (!lookup.available) capability = { available: false, reason: lookup.reason };
    else if (lookup.value) capability = { available: false, reason: lookup.value.reason };
  }

  const resolvedMode = useMemo(() => {
    if (!mode) return mode;
    if (modeId === 'qr') {
      return {
        ...mode,
        input: effectiveQrOperation === 'generate'
          ? { kind: 'text', label: 'QR content', hint: 'Up to 2,953 characters.' }
          : {
              kind: 'files',
              multiple: false,
              acceptFromJob: 'qr',
              selectable: true,
            },
        options: qrOptions(),
        run: {
          ...mode.run,
          label: effectiveQrOperation === 'generate' ? 'Generate QR' : 'Decode image',
        },
      };
    }
    const imageMode = colorMode === 'image';
    return {
      ...mode,
      input: imageMode
        ? {
            kind: 'files',
            multiple: false,
            acceptFromJob: 'image',
            selectable: true,
          }
        : { kind: 'none' },
      options: colorOptions(colorMode, colorForm),
      run: {
        ...mode.run,
        label: imageMode
          ? COLOR_IMAGE_OPERATIONS.find((entry) => entry.value === colorForm.imageOperation)?.label
            || 'Run image job'
          : 'Save color result',
      },
    };
  }, [
    colorForm,
    colorMode,
    contractTick,
    effectiveQrOperation,
    mode,
    modeId,
  ]);

  const onOptionChange = useCallback((id, value) => {
    setActionError('');
    if (modeId === 'qr') {
      if (id === 'operation') {
        const next = defaultQrForm(String(value));
        setQrForm(next);
        setInputValue(next.content);
        setSelectedFileId('');
        return;
      }
      setQrForm((current) => ({
        ...current,
        [id]: String(value),
      }));
      return;
    }
    setColorForm((current) => ({
      ...current,
      [id]: typeof current[id] === 'boolean' ? Boolean(value) : String(value),
    }));
    if (id === 'colorMode') {
      setSelectedFileId('');
      setLocalResults([]);
      setActionError('');
    }
  }, [modeId]);

  const onToggleFile = useCallback((fileId) => {
    const id = String(fileId);
    setSelectedFileId((current) => current === id ? '' : id);
    setActionError('');
  }, []);

  const onFiles = useCallback(async (incoming) => {
    if (!snapshot.workspaceId || !acceptLookup.available) {
      setActionError(capability.reason || 'Utility input is unavailable.');
      return;
    }
    const files = Array.from(incoming || []);
    const rejected = files.filter((file) => !matchesAccept(file, accept));
    if (rejected.length) {
      setActionError(`${rejected.map((file) => file.name).join(', ')} is not accepted by the published contract.`);
      return;
    }
    const file = files[0];
    if (!file) return;
    if (modeId === 'color') {
      setLocalImageFile(file);
      if (localImageUrlRef.current) URL.revokeObjectURL(localImageUrlRef.current);
      const nextUrl = URL.createObjectURL(file);
      localImageUrlRef.current = nextUrl;
      setLocalImageUrl(nextUrl);
      void extractLocalPalette(file);
    }
    const task = createUploadTask(file, { workspaceId: snapshot.workspaceId });
    tasksRef.current.set(task.clientId, task);
    try {
      const uploaded = await task.start();
      setSelectedFileId(String(uploaded.id));
      await hydrate({ route: 'utilities' });
    } catch (error) {
      if (!['PAUSED', 'CANCELLED'].includes(error?.code)) setActionError(failedReason(error));
    } finally {
      if (['completed', 'failed'].includes(task.state)) tasksRef.current.delete(task.clientId);
    }
  }, [
    accept,
    acceptLookup.available,
    capability.reason,
    extractLocalPalette,
    modeId,
    snapshot.workspaceId,
  ]);

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
      await hydrate({ route: 'utilities' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const onRun = useCallback(async () => {
    if (modeId === 'color' && colorMode !== 'image') {
      const result = computeColorLab(colorForm, colorPalette);
      const localText = JSON.stringify(result, null, 2);
      setLocalResults([{
        id: `color-${Date.now()}`,
        name: `${colorMode} result`,
        status: 'completed',
        sourceLabel: 'Browser-only',
        outputFormat: 'json',
        detail: colorMode === 'contrast' && result.contrast.ratio
          ? `${result.contrast.ratio.toFixed(2)}:1`
          : colorMode === 'gradient'
            ? result.gradient
            : `${result.palette.length} colors`,
        localText,
      }]);
      return;
    }
    if (!snapshot.workspaceId) return;
    const uploadIds = selectedFile ? [String(selectedFile.id)] : [];
    const validation = modeId === 'qr'
      ? validateQrWorkbench({ ...qrForm, operation: effectiveQrOperation, content: inputValue }, uploadIds)
      : validateColorImageJob(colorForm, uploadIds);
    if (validation) {
      setActionError(validation);
      return;
    }
    if (selectedFile && (selectedFile.localOnly || selectedFile.status !== 'ready')) {
      setActionError('Wait for the selected file to finish uploading and inspection.');
      return;
    }
    let key = '';
    try {
      const clientRequestId = requestId();
      const options = modeId === 'qr'
        ? buildQrJobOptions({
            ...qrForm,
            operation: effectiveQrOperation,
            content: inputValue,
          }, uploadIds)
        : buildColorImageJobOptions(colorForm, uploadIds);
      const jobType = modeId === 'qr' ? 'qr' : 'image';
      key = optimisticRequest('convert', uploadIds[0] || `${modeId}-inline`, { clientRequestId });
      const job = await api.createJob({
        type: jobType,
        workspaceId: snapshot.workspaceId,
        uploadIds,
        clientRequestId,
        options,
      });
      applyPoll({ job });
      rememberActiveJob('utilities', modeId, job.id);
      setAttemptJobIds([job.id]);
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      if (key) resolveRequest(key);
    }
  }, [
    colorForm,
    colorMode,
    colorPalette,
    effectiveQrOperation,
    inputValue,
    modeId,
    qrForm,
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
    for (const row of jobs) {
      if (row.localText != null) {
        setLocalResults((current) => current.map((entry) => (
          entry.id === row.id ? { ...entry, id: `color-${Date.now()}` } : entry
        )));
        continue;
      }
      try {
        const originalId = row.jobId || row.id;
        const original = snapshot.jobs.find((entry) => entry.id === originalId) || row;
        const uploadIds = original.options?._uploadIds || original.options?.uploadIds || [];
        const next = await api.createJob({
          type: original.type || (modeId === 'qr' ? 'qr' : 'image'),
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
  }, [modeId, snapshot.jobs, snapshot.workspaceId]);

  const onRemoveResult = useCallback(async (result) => {
    if (result.localText != null) {
      setLocalResults((current) => current.filter((entry) => entry.id !== result.id));
      return;
    }
    const id = result.jobId || result.id;
    const key = optimisticRequest('delete', id);
    try {
      await api.deleteJob(id);
      await hydrate({ route: 'utilities' });
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

  const copyColorResult = useCallback(() => {
    const text = colorMode === 'gradient'
      ? colorResult.gradient
      : colorMode === 'contrast'
        ? `foreground: ${colorResult.contrast.foreground}; background: ${colorResult.contrast.background}; ratio: ${colorResult.contrast.ratio?.toFixed(2) || '—'}`
        : colorResult.palette.join(', ');
    void copyText(text).then((ok) => {
      if (!ok) setActionError('Could not copy the color result.');
    });
  }, [colorMode, colorResult]);

  const onPanelDispatch = useCallback((panelKey, action) => {
    if (!action || typeof action !== 'object') return;
    setActionError('');
    if (panelKey === 'qr-designer') {
      if (action.type === 'set-form') {
        setQrForm((current) => ({ ...current, [action.id]: String(action.value) }));
      }
      if (action.type === 'paste-files') void onFiles(action.files);
      if (action.type === 'choose-image') openInput();
      if (action.type === 'copy-decoded') {
        void copyText(qrPreview.decodedText).then((ok) => {
          if (!ok) setActionError('Could not copy decoded text.');
        });
      }
      return;
    }
    if (action.type === 'set-form') {
      setColorForm((current) => ({ ...current, [action.id]: String(action.value) }));
    }
    if (action.type === 'select-swatch') {
      setColorForm((current) => ({ ...current, hex: String(action.value) }));
    }
    if (action.type === 'extract-palette') void extractLocalPalette();
    if (action.type === 'copy-result') copyColorResult();
    if (action.type === 'export-palette') {
      downloadText(
        'palette.json',
        paletteToJson(colorResult.palette, { source: colorMode, seed: colorResult.hex }),
        'application/json',
      );
    }
  }, [
    colorMode,
    colorResult,
    copyColorResult,
    extractLocalPalette,
    onFiles,
    openInput,
    qrPreview.decodedText,
  ]);

  return enabled ? {
    mode: resolvedMode,
    capability,
    accept,
    optionValues: modeId === 'qr'
      ? { ...qrForm, operation: effectiveQrOperation }
      : colorForm,
    inputValue,
    panelState: {
      'qr-designer': {
        visible: modeId === 'qr',
        form: { ...qrForm, operation: effectiveQrOperation, content: inputValue },
        accept,
        ...qrPreview,
      },
      'color-lab': {
        visible: modeId === 'color',
        form: colorForm,
        result: colorResult,
        palette: colorPalette,
        status: colorExtraction.status,
        error: colorExtraction.error,
        hasImage: Boolean(localImageFile || selectedFile),
        previewUrl: localImageUrl,
      },
    },
    inputFiles: fileMode ? compatibleFiles : [],
    selectedFileIds: selectedFileId ? [selectedFileId] : [],
    attemptJobIds: currentAttemptJobIds,
    resultRows,
    actionError,
    onInputValueChange: (value) => {
      const content = String(value || '');
      setInputValue(content);
      setQrForm((current) => ({ ...current, content }));
      setActionError('');
    },
    onOptionChange,
    onPanelDispatch,
    onPanelRecover: () => setActionError('Continue with the standard utility controls while this panel is unavailable.'),
    onToggleFile,
    onFiles,
    onRemoveFile,
    onRun,
    onCancel,
    onRetry: (job) => retryJobs([job]),
    onRetryAll: retryJobs,
    onRemoveResult,
    onRemoveBadInput: () => setActionError('Remove the source from Input and upload a corrected file.'),
    onResumeUpload: openInput,
    onDiscardUpload,
    onAddInput: openInput,
    onDownload: async (result) => {
      try {
        if (result.localText != null) {
          downloadText(`${result.name || 'color-result'}.json`, result.localText, 'application/json');
        } else if (result.downloadUrl) {
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
        rows.filter((row) => row.localText != null).forEach((row) => {
          downloadText(`${row.name || 'color-result'}.json`, row.localText, 'application/json');
        });
        const remoteRows = rows.filter((row) => row.localText == null);
        if (remoteRows.length) {
          await api.downloadOutputsZip(snapshot.workspaceId, {
            outputIds: remoteRows.map((row) => row.outputId || row.id).filter(Boolean),
            jobIds: remoteRows.map((row) => row.jobId).filter(Boolean),
          });
        }
      } catch (error) {
        setActionError(failedReason(error));
      }
    },
    onRetryHydrate: () => hydrate({ route: 'utilities' }),
  } : {};
}

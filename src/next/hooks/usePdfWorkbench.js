import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/client.js';
import {
  acceptAttributeFor,
  gatedOperation,
  getContractState,
  loadContracts,
  qualityPresets,
} from '../../protocol/contracts.js';
import {
  applyPoll,
  hydrate,
  optimisticRequest,
  rememberActiveJob,
  resolveOptimisticUpload,
  resolveRequest,
} from '../../protocol/store.js';
import {
  createUploadTask,
  recoverUploadSessions,
} from '../../protocol/uploads.js';
import {
  buildPdfJobRequest,
  buildPdfResultRows,
  buildPdfRetryRequest,
  defaultFormStateForOperation,
  pdfOperationEngineLabel,
  publishedPdfOperations,
  unsupportedPdfOptionKeys,
  validatePdfClient,
} from '../../lib/pdfJobOptions.js';
import { PDF_PREVIEW_BYTE_LIMIT, formatPreviewBytes } from '../../lib/pdfPreview.js';
import useStore from './useStore.js';

const selectSnapshot = (snapshot) => snapshot;
const ORGANIZER_OPERATION_IDS = new Set([
  'reorder',
  'rotate',
  'extract',
  'delete-pages',
  'duplicate-pages',
]);

function requestId(prefix = 'pdf') {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function failedReason(error) {
  return error instanceof Error ? error.message : String(error || 'PDF operation failed');
}

function optionLabel(value) {
  return String(value || '')
    .replace(/-/g, ' ')
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

function fileMatchesAccept(file, accept) {
  if (!accept) return true;
  const name = String(file?.originalName || file?.name || '').toLowerCase();
  const mime = String(file?.mime || file?.type || '').toLowerCase();
  return accept.split(',').some((token) => {
    const rule = token.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return mime.startsWith(rule.slice(0, -1));
    return mime === rule;
  });
}

function formOptionsFor(operation, presets) {
  if (!operation) return [];
  const keys = new Set(operation.options || []);
  const options = [{
    id: 'engine',
    type: 'derived',
    label: 'Execution engine',
    value: pdfOperationEngineLabel(operation),
    hint: `Server policy: ${operation.enginePolicy?.strategy || 'not published'}.`,
  }];
  const pageLabel = operation.id === 'reorder'
    ? 'Page order'
    : operation.id === 'split'
      ? 'Page ranges'
      : 'Pages';
  const pageHint = operation.id === 'reorder'
    ? 'Enter a 1-based order such as 3,1,2.'
    : 'Use all, odd, 1-3,5, 1-, or last.';

  if (keys.has('splitMode')) {
    options.push({
      id: 'splitMode',
      type: 'select',
      label: 'Split mode',
      options: [
        { value: 'every-page', label: 'Every page' },
        { value: 'ranges', label: 'Selected ranges' },
        { value: 'every-n', label: 'Every N pages' },
        { value: 'groups', label: 'Custom groups' },
      ],
    });
  }
  if (
    (keys.has('pages') || keys.has('order'))
    && !(operation.id === 'split')
  ) {
    options.push({
      id: 'pages',
      type: 'text',
      label: pageLabel,
      hint: pageHint,
      required: ['reorder', 'extract', 'delete-pages', 'duplicate-pages'].includes(operation.id),
    });
  }
  if (operation.id === 'split') {
    options.push({
      id: 'pages',
      type: 'text',
      label: 'Page ranges',
      hint: 'Used only when Split mode is Selected ranges.',
    });
    options.push({
      id: 'everyN',
      type: 'text',
      label: 'Pages per part',
      hint: 'Used only when Split mode is Every N pages.',
    });
    options.push({
      id: 'splitGroups',
      type: 'text',
      label: 'Custom groups',
      hint: 'Separate page specifications with semicolons, for example 1-2;3;4-6.',
    });
  }
  if (keys.has('angle')) {
    options.push({
      id: 'angle',
      type: 'select',
      label: 'Rotation',
      options: [
        { value: '90', label: '90 degrees' },
        { value: '180', label: '180 degrees' },
        { value: '270', label: '270 degrees' },
      ],
    });
  }
  if (keys.has('allowDuplicates')) {
    options.push({
      id: 'allowDuplicates',
      type: 'toggle',
      label: 'Allow duplicate pages',
      hint: 'Off requires a full permutation of the source pages.',
      default: false,
    });
  }
  if (keys.has('insertAt')) {
    options.push({
      id: 'insertAt',
      type: 'text',
      label: 'Insert copies at',
      hint: 'Optional 0-based position. Leave empty to insert after each original.',
    });
  }
  if (keys.has('format')) {
    options.push({
      id: 'format',
      type: 'select',
      label: 'Image format',
      options: (operation.outputKinds || [])
        .filter((kind) => kind !== 'zip')
        .map((kind) => ({ value: kind, label: String(kind).toUpperCase() })),
    });
  }
  if (keys.has('dpi')) {
    options.push({
      id: 'dpi',
      type: 'text',
      label: 'Resolution in DPI',
      hint: 'Accepted range: 36 to 600.',
    });
  }
  if (keys.has('quality')) {
    options.push({
      id: 'quality',
      type: 'select',
      label: 'Quality preset',
      options: presets.map((preset) => ({ value: preset, label: optionLabel(preset) })),
      disabled: presets.length === 0,
      hint: presets.length ? 'Presets are published by the server.' : 'No quality presets were published.',
    });
  }
  if (keys.has('pageSize')) {
    options.push({
      id: 'pageSize',
      type: 'select',
      label: 'Page size',
      options: [
        { value: 'fit-to-image', label: 'Fit to image' },
        { value: 'a4', label: 'A4' },
        { value: 'letter', label: 'Letter' },
        { value: 'original', label: 'Original image size' },
      ],
    });
  }
  if (keys.has('orientation')) {
    options.push({
      id: 'orientation',
      type: 'select',
      label: 'Orientation',
      options: [
        { value: 'auto', label: 'Auto' },
        { value: 'portrait', label: 'Portrait' },
        { value: 'landscape', label: 'Landscape' },
      ],
    });
  }
  if (keys.has('fit')) {
    options.push({
      id: 'fit',
      type: 'select',
      label: 'Image fit',
      options: [
        { value: 'contain', label: 'Contain' },
        { value: 'cover', label: 'Cover' },
        { value: 'stretch', label: 'Stretch' },
      ],
    });
  }
  if (keys.has('marginPt')) {
    options.push({
      id: 'margin',
      type: 'text',
      label: 'Margin in points',
      hint: 'Use 0 for edge-to-edge placement.',
    });
  }
  if (keys.has('ocrLang')) {
    options.push({
      id: 'ocrLang',
      type: 'text',
      label: 'OCR language',
      hint: 'Examples: eng, vie, or eng+vie.',
    });
  }
  if (keys.has('ocrPageLimit')) {
    options.push({
      id: 'ocrPageLimit',
      type: 'text',
      label: 'OCR page limit',
      hint: 'Accepted range: 1 to 200 pages.',
    });
  }
  return options;
}

function sortInputFiles(files, selectedIds) {
  const order = new Map(selectedIds.map((id, index) => [String(id), index]));
  return [...files].sort((a, b) => {
    const aIndex = order.has(String(a.id)) ? order.get(String(a.id)) : Number.MAX_SAFE_INTEGER;
    const bIndex = order.has(String(b.id)) ? order.get(String(b.id)) : Number.MAX_SAFE_INTEGER;
    if (aIndex !== bIndex) return aIndex - bIndex;
    return Date.parse(b.createdAt || b.updatedAt || '') - Date.parse(a.createdAt || a.updatedAt || '');
  });
}

export default function usePdfWorkbench({ enabled, mode }) {
  const snapshot = useStore(selectSnapshot);
  const [contractTick, setContractTick] = useState(0);
  const [operationId, setOperationId] = useState('merge');
  const [organizerOperationId, setOrganizerOperationId] = useState('reorder');
  const [form, setForm] = useState(() => defaultFormStateForOperation('merge'));
  const [selectedFileIds, setSelectedFileIds] = useState([]);
  const [pauseableFileIds, setPauseableFileIds] = useState([]);
  const [attemptJobIds, setAttemptJobIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const [previewRetry, setPreviewRetry] = useState(0);
  const [organizerPreview, setOrganizerPreview] = useState({
    status: 'idle',
    file: null,
    error: '',
  });
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

  const contract = getContractState();
  const operations = useMemo(
    () => contract.status === 'ready' ? publishedPdfOperations(contract.contract.raw) : [],
    [contract, contractTick],
  );
  const qualityLookup = useMemo(() => qualityPresets(), [contractTick]);
  const presets = qualityLookup.available ? qualityLookup.value : [];
  const qualityDefault = contract.status === 'ready' ? contract.contract.quality.default : '';
  const organizerOperations = useMemo(
    () => operations.filter((entry) => ORGANIZER_OPERATION_IDS.has(entry.id)),
    [operations],
  );
  const effectiveOperationId = mode?.id === 'organize' ? organizerOperationId : operationId;
  const operation = operations.find((entry) => entry.id === effectiveOperationId) || null;

  useEffect(() => {
    if (!operations.length || mode?.id !== 'operations') return;
    if (operations.some((entry) => entry.id === operationId)) return;
    const first = operations[0];
    setOperationId(first.id);
    setForm({
      ...defaultFormStateForOperation(first.id),
      ...(qualityDefault ? { quality: qualityDefault } : {}),
    });
  }, [mode?.id, operationId, operations, qualityDefault]);

  useEffect(() => {
    if (!organizerOperations.length || mode?.id !== 'organize') return;
    if (organizerOperations.some((entry) => entry.id === organizerOperationId)) return;
    const first = organizerOperations[0];
    setOrganizerOperationId(first.id);
    setForm({
      ...defaultFormStateForOperation(first.id),
      ...(qualityDefault ? { quality: qualityDefault } : {}),
    });
  }, [mode?.id, organizerOperationId, organizerOperations, qualityDefault]);

  useEffect(() => {
    if (!qualityDefault) return;
    setForm((current) => (
      presets.includes(current.quality)
        ? current
        : { ...current, quality: qualityDefault }
    ));
  }, [presets, qualityDefault]);

  const acceptLookup = useMemo(() => {
    if (!enabled || mode?.id === 'export' || !operation) {
      return { available: mode?.id === 'export', value: '' };
    }
    return acceptAttributeFor('pdf', operation.id);
  }, [contractTick, enabled, mode?.id, operation]);
  const accept = acceptLookup.available ? acceptLookup.value : '';
  const compatibleFiles = useMemo(
    () => snapshot.files.filter((file) => (
      file.status !== 'deleted'
      && file.status !== 'missing'
      && fileMatchesAccept(file, accept)
    )),
    [accept, snapshot.files],
  );
  const inputFiles = useMemo(
    () => sortInputFiles(compatibleFiles, selectedFileIds),
    [compatibleFiles, selectedFileIds],
  );

  useEffect(() => {
    const compatibleIds = new Set(compatibleFiles.map((file) => String(file.id)));
    const maxFiles = operation?.cardinality?.maxFiles;
    setSelectedFileIds((current) => {
      let next = current.filter((id) => compatibleIds.has(String(id)));
      if (maxFiles != null) next = next.slice(0, maxFiles);
      return next.length === current.length && next.every((id, index) => id === current[index])
        ? current
        : next;
    });
  }, [compatibleFiles, operation?.cardinality?.maxFiles]);

  const selectedFiles = useMemo(() => {
    const byId = new Map(compatibleFiles.map((file) => [String(file.id), file]));
    return selectedFileIds.map((id) => byId.get(String(id))).filter(Boolean);
  }, [compatibleFiles, selectedFileIds]);
  const organizerFile = mode?.id === 'organize' ? selectedFiles[0] || null : null;

  useEffect(() => {
    if (!enabled || mode?.id !== 'organize' || !organizerFile) {
      setOrganizerPreview({ status: 'idle', file: null, error: '' });
      return undefined;
    }
    if (organizerFile.localOnly || organizerFile.status !== 'ready') {
      setOrganizerPreview({ status: 'loading', file: null, error: '' });
      return undefined;
    }
    if (Number(organizerFile.size) > PDF_PREVIEW_BYTE_LIMIT) {
      setOrganizerPreview({
        status: 'limited',
        file: null,
        error: `Preview is limited to ${formatPreviewBytes(PDF_PREVIEW_BYTE_LIMIT)}. Manual page entry and backend processing remain available.`,
      });
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setOrganizerPreview({ status: 'loading', file: null, error: '' });
    void api.fetchFileBlob(organizerFile.id, { signal: controller.signal })
      .then((blob) => {
        if (!active) return;
        if (blob.size > PDF_PREVIEW_BYTE_LIMIT) {
          setOrganizerPreview({
            status: 'limited',
            file: null,
            error: `Preview is limited to ${formatPreviewBytes(PDF_PREVIEW_BYTE_LIMIT)}. Manual page entry and backend processing remain available.`,
          });
          return;
        }
        const name = organizerFile.originalName || organizerFile.name || 'document.pdf';
        setOrganizerPreview({
          status: 'ready',
          file: new File([blob], name, {
            type: blob.type || organizerFile.mime || 'application/pdf',
            lastModified: Date.parse(organizerFile.updatedAt || organizerFile.createdAt || '') || 0,
          }),
          error: '',
        });
      })
      .catch((error) => {
        if (!active || controller.signal.aborted) return;
        setOrganizerPreview({
          status: 'error',
          file: null,
          error: failedReason(error),
        });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [
    enabled,
    mode?.id,
    organizerFile?.createdAt,
    organizerFile?.id,
    organizerFile?.localOnly,
    organizerFile?.mime,
    organizerFile?.originalName,
    organizerFile?.size,
    organizerFile?.status,
    organizerFile?.updatedAt,
    previewRetry,
  ]);
  const activePdfJobIds = useMemo(
    () => snapshot.jobs
      .filter((job) => job.type === 'pdf' && ['queued', 'running'].includes(job.status))
      .map((job) => job.id),
    [snapshot.jobs],
  );
  const currentAttemptJobIds = useMemo(
    () => [...new Set([...attemptJobIds, ...activePdfJobIds])],
    [activePdfJobIds, attemptJobIds],
  );
  useEffect(() => {
    if (!activePdfJobIds.length) return;
    setAttemptJobIds((current) => [...new Set([...current, ...activePdfJobIds])]);
  }, [activePdfJobIds]);

  const resultRows = useMemo(() => buildPdfResultRows({
    jobs: snapshot.jobs,
    outputs: snapshot.outputs,
    files: snapshot.files,
  }), [snapshot.files, snapshot.jobs, snapshot.outputs]);
  const completedPdfOutputs = useMemo(
    () => resultRows.filter((row) => row.status === 'completed' && row.outputId),
    [resultRows],
  );

  const operationChoices = useMemo(() => operations.map((entry) => {
    const lookup = gatedOperation(entry.capability);
    const unavailable = !lookup.available || Boolean(lookup.value);
    const reason = lookup.available ? lookup.value?.reason : lookup.reason;
    return {
      value: entry.id,
      label: `${entry.groupLabel}: ${entry.label}${unavailable ? ' (unavailable)' : ''}`,
      disabled: unavailable,
      reason,
    };
  }), [contractTick, operations]);
  const organizerOperationChoices = useMemo(
    () => organizerOperations.map((entry) => {
      const lookup = gatedOperation(entry.capability);
      const unavailable = !lookup.available || Boolean(lookup.value);
      return {
        value: entry.id,
        label: entry.label,
        disabled: unavailable,
        reason: lookup.available ? lookup.value?.reason : lookup.reason,
      };
    }),
    [contractTick, organizerOperations],
  );

  const unsupportedOptions = unsupportedPdfOptionKeys(operation);
  let capability;
  if (!enabled || mode?.id === 'export') {
    capability = { available: true };
  } else if (contract.status === 'idle' || contract.status === 'loading') {
    capability = { available: false, reason: 'Loading PDF capabilities...' };
  } else if (contract.status === 'unavailable') {
    capability = { available: false, reason: contract.reason };
  } else if (!operations.length || !operation) {
    capability = {
      available: false,
      reason: 'The server did not publish a usable PDF operation contract.',
    };
  } else if (!acceptLookup.available) {
    capability = { available: false, reason: acceptLookup.reason };
  } else if (unsupportedOptions.length) {
    capability = {
      available: false,
      reason: `This client does not support the published option: ${unsupportedOptions.join(', ')}.`,
    };
  } else {
    const lookup = gatedOperation(operation.capability);
    capability = !lookup.available
      ? { available: false, reason: lookup.reason }
      : lookup.value
        ? { available: false, reason: lookup.value.reason }
        : { available: true };
  }

  const resolvedMode = useMemo(() => {
    if (!mode) return mode;
    if (mode.id === 'export') {
      return {
        ...mode,
        options: mode.options.map((item) => (
          item.id === 'exportScope'
            ? {
                ...item,
                value: completedPdfOutputs.length
                  ? `${completedPdfOutputs.length} completed PDF ${completedPdfOutputs.length === 1 ? 'output' : 'outputs'}`
                  : 'No completed PDF outputs yet',
              }
            : item
        )),
      };
    }
    if (mode.id === 'organize') {
      return {
        ...mode,
        input: { ...mode.input, multiple: false },
        options: [],
      };
    }
    return {
      ...mode,
      input: {
        ...mode.input,
        multiple: operation?.cardinality?.maxFiles !== 1,
      },
      options: [
        {
          ...mode.options[0],
          options: operationChoices,
          disabled: !operationChoices.length,
        },
        ...formOptionsFor(operation, presets),
      ],
    };
  }, [completedPdfOutputs.length, mode, operation, operationChoices, presets]);

  const onOptionChange = useCallback((id, value) => {
    setActionError('');
    if (id === 'operation') {
      const nextId = String(value);
      setOperationId(nextId);
      setForm({
        ...defaultFormStateForOperation(nextId),
        ...(qualityDefault ? { quality: qualityDefault } : {}),
      });
      return;
    }
    setForm((current) => ({
      ...current,
      [id]: typeof current[id] === 'boolean' ? Boolean(value) : String(value),
    }));
  }, [qualityDefault]);

  const onPanelDispatch = useCallback((_panelKey, action) => {
    setActionError('');
    if (!action || typeof action !== 'object') return;
    if (action.type === 'set-operation') {
      const nextId = String(action.value || '');
      if (!ORGANIZER_OPERATION_IDS.has(nextId)) return;
      setOrganizerOperationId(nextId);
      setForm({
        ...defaultFormStateForOperation(nextId),
        ...(qualityDefault ? { quality: qualityDefault } : {}),
      });
      return;
    }
    if (action.type === 'set-plan') {
      setForm((current) => ({
        ...current,
        editPlan: action.plan || null,
        pages: action.plan?.order || action.plan?.pages || current.pages,
      }));
    }
    if (action.type === 'set-pages') {
      setForm((current) => ({ ...current, pages: String(action.value || '') }));
    }
    if (action.type === 'set-angle') {
      setForm((current) => ({ ...current, angle: String(action.value || '90') }));
    }
    if (action.type === 'retry-preview') {
      setPreviewRetry((value) => value + 1);
    }
  }, [qualityDefault]);

  const onToggleFile = useCallback((fileId) => {
    const id = String(fileId);
    const maxFiles = operation?.cardinality?.maxFiles;
    setSelectedFileIds((current) => {
      if (current.includes(id)) return current.filter((entry) => entry !== id);
      if (maxFiles === 1) return [id];
      if (maxFiles != null && current.length >= maxFiles) return current;
      return [...current, id];
    });
    setActionError('');
  }, [operation?.cardinality?.maxFiles]);

  const onMoveFile = useCallback((fileId, delta) => {
    const id = String(fileId);
    setSelectedFileIds((current) => {
      const index = current.indexOf(id);
      const nextIndex = index + Number(delta);
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }, []);

  const onFiles = useCallback(async (incoming) => {
    if (!enabled || !snapshot.workspaceId || !acceptLookup.available) {
      setActionError(capability.reason || 'PDF input is unavailable.');
      return;
    }
    const batch = Array.from(incoming || []);
    const rejected = batch.filter((file) => !fileMatchesAccept(file, accept));
    if (rejected.length) {
      setActionError(`${rejected.map((file) => file.name).join(', ')} does not match this operation.`);
      return;
    }
    setActionError('');
    const uploadedIds = (await Promise.all(batch.map(async (file) => {
      let task;
      task = createUploadTask(file, {
        workspaceId: snapshot.workspaceId,
        onState: (state) => {
          if (task.kind !== 'resumable') return;
          setPauseableFileIds((current) => {
            const next = new Set(current);
            if (state === 'uploading') next.add(task.clientId);
            else next.delete(task.clientId);
            return [...next];
          });
        },
      });
      tasksRef.current.set(task.clientId, task);
      try {
        const uploaded = await task.start();
        return String(uploaded.id);
      } catch (error) {
        if (!['PAUSED', 'CANCELLED'].includes(error?.code)) {
          setActionError(failedReason(error));
        }
        return null;
      } finally {
        if (task.state === 'completed' || task.state === 'failed') {
          tasksRef.current.delete(task.clientId);
        }
      }
    }))).filter(Boolean);
    const maxFiles = operation?.cardinality?.maxFiles;
    setSelectedFileIds((current) => {
      const next = maxFiles === 1 ? uploadedIds.slice(-1) : [...current, ...uploadedIds];
      return [...new Set(next)].slice(0, maxFiles ?? Number.MAX_SAFE_INTEGER);
    });
    await hydrate({ route: 'pdf' });
  }, [
    accept,
    acceptLookup.available,
    capability.reason,
    enabled,
    operation?.cardinality?.maxFiles,
    snapshot.workspaceId,
  ]);

  const onPauseFile = useCallback(async (file) => {
    const task = tasksRef.current.get(String(file.id));
    if (!task || task.kind !== 'resumable') {
      setActionError('Only an active resumable upload can be paused.');
      return;
    }
    try {
      await task.pause();
      if (snapshot.workspaceId) await recoverUploadSessions(snapshot.workspaceId);
    } catch (error) {
      setActionError(failedReason(error));
    }
  }, [snapshot.workspaceId]);

  const onRemoveFile = useCallback(async (file) => {
    if (!snapshot.workspaceId) return;
    const id = String(file.id);
    setSelectedFileIds((current) => current.filter((entry) => entry !== id));
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
      await hydrate({ route: 'pdf' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

  const queuePdfJob = useCallback(async () => {
    if (!snapshot.workspaceId || !operation) return;
    setActionError('');
    const pending = selectedFiles.find((file) => file.localOnly || file.status !== 'ready');
    if (pending) {
      setActionError(`Wait for ${pending.originalName || pending.name} to finish uploading and inspection.`);
      return;
    }
    const validation = validatePdfClient({
      operation: operation.id,
      files: selectedFiles,
      opMeta: operation,
      ...form,
    });
    if (validation) {
      setActionError(validation);
      return;
    }
    let key = '';
    try {
      const body = buildPdfJobRequest({
        workspaceId: snapshot.workspaceId,
        uploadIds: selectedFileIds,
        clientRequestId: requestId(),
        operation: operation.id,
        form,
        opMeta: operation,
      });
      key = optimisticRequest('convert', selectedFileIds.join(','), {
        clientRequestId: body.clientRequestId,
      });
      const job = await api.createJob(body);
      applyPoll({ job });
      rememberActiveJob('pdf', mode?.id || 'operations', job.id);
      setAttemptJobIds([job.id]);
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      if (key) resolveRequest(key);
    }
  }, [
    form,
    mode?.id,
    operation,
    selectedFileIds,
    selectedFiles,
    snapshot.workspaceId,
  ]);

  const downloadRows = useCallback(async (rows) => {
    if (!snapshot.workspaceId) return;
    const completed = rows.filter((row) => row.status === 'completed');
    if (!completed.length) {
      setActionError('No completed PDF output is available to download.');
      return;
    }
    try {
      await api.downloadOutputsZip(snapshot.workspaceId, {
        outputIds: completed.map((row) => row.outputId || row.id).filter(Boolean),
        jobIds: completed.map((row) => row.jobId).filter(Boolean),
      });
    } catch (error) {
      setActionError(failedReason(error));
    }
  }, [snapshot.workspaceId]);

  const onRun = useCallback(() => (
    mode?.id === 'export' ? downloadRows(completedPdfOutputs) : queuePdfJob()
  ), [completedPdfOutputs, downloadRows, mode?.id, queuePdfJob]);

  const onCancel = useCallback(async () => {
    const attemptIds = new Set(currentAttemptJobIds);
    const active = snapshot.jobs.filter((job) => (
      job.type === 'pdf'
      && attemptIds.has(job.id)
      && ['queued', 'running'].includes(job.status)
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
  }, [currentAttemptJobIds, snapshot.jobs]);

  const retryJobs = useCallback(async (jobs) => {
    if (!snapshot.workspaceId) return;
    setActionError('');
    const nextAttemptIds = [];
    const failures = [];
    for (const job of jobs) {
      let key = '';
      try {
        const body = buildPdfRetryRequest({
          workspaceId: snapshot.workspaceId,
          job,
          clientRequestId: requestId('pdf-retry'),
        });
        key = optimisticRequest('convert', job.id, {
          clientRequestId: body.clientRequestId,
        });
        const next = await api.createJob(body);
        applyPoll({ job: next });
        rememberActiveJob('pdf', 'operations', next.id);
        nextAttemptIds.push(next.id);
      } catch (error) {
        failures.push(failedReason(error));
      } finally {
        if (key) resolveRequest(key);
      }
    }
    if (nextAttemptIds.length) setAttemptJobIds(nextAttemptIds);
    if (failures.length) setActionError(failures[0]);
  }, [snapshot.workspaceId]);

  const onRemoveResult = useCallback(async (result) => {
    const id = result.jobId || result.id;
    const key = optimisticRequest('delete', id);
    try {
      await api.deleteJob(id);
      await hydrate({ route: 'pdf' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, []);

  const onRemoveBadInput = useCallback(async (result) => {
    const inputIds = result.options?._uploadIds || result.options?.uploadIds || [];
    if (!snapshot.workspaceId || inputIds.length !== 1) {
      setActionError('Select the bad source in Input when a failed job has multiple files.');
      return;
    }
    const fileId = String(inputIds[0]);
    const key = optimisticRequest('delete', fileId);
    try {
      await api.deleteJob(result.jobId || result.id);
      await api.removeWorkspaceFile(snapshot.workspaceId, fileId);
      setSelectedFileIds((current) => current.filter((id) => id !== fileId));
      await hydrate({ route: 'pdf' });
    } catch (error) {
      setActionError(failedReason(error));
    } finally {
      resolveRequest(key);
    }
  }, [snapshot.workspaceId]);

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
    optionValues: {
      operation: effectiveOperationId,
      ...form,
    },
    panelState: {
      'pdf-organizer': {
        file: selectedFiles[0] || null,
        previewFile: organizerPreview.file,
        previewStatus: organizerPreview.status,
        previewError: organizerPreview.error,
        operations: organizerOperationChoices,
        operation: operation?.id || 'reorder',
        editPlan: form.editPlan,
        pages: form.pages,
        angle: form.angle,
        disabled: activePdfJobIds.length > 0,
      },
    },
    inputFiles,
    selectedFileIds,
    attemptJobIds: currentAttemptJobIds,
    resultRows,
    actionError,
    pauseableFileIds,
    onOptionChange,
    onPanelDispatch,
    onPanelRecover: () => setActionError('Upload a readable PDF before organizing pages.'),
    onToggleFile,
    onMoveFile: operation?.cardinality?.maxFiles === 1 ? undefined : onMoveFile,
    onFiles,
    onPauseFile,
    onRemoveFile,
    onRun,
    onCancel,
    onRetry: (job) => retryJobs([job]),
    onRetryAll: retryJobs,
    onRemoveResult,
    onRemoveBadInput,
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
    onDownloadBatch: downloadRows,
    onRetryHydrate: () => hydrate({ route: 'pdf' }),
  } : {};
}
